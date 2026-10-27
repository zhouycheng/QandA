package qanda.backend.content

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import qanda.backend.content.api.QuestionType
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.FieldError
import java.text.Normalizer
import java.util.UUID

internal fun invalid(pointer: String = "", code: String = "VALIDATION_FAILED", message: String = "字段不符合要求"): Nothing =
    throw ApiException(HttpStatus.UNPROCESSABLE_ENTITY,code,message,listOf(FieldError(pointer,code,message)))
internal fun shape(pointer: String = ""): Nothing = throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_REQUEST","请求JSON字段不符合要求",listOf(FieldError(pointer,"INVALID_FIELD","字段不符合要求")))
internal fun missing(): Nothing = throw ApiException(HttpStatus.NOT_FOUND,"NOT_FOUND","资源不存在或不可访问")
internal fun unavailable(code: String = "CONTENT_INTEGRITY_FAILURE"): Nothing = throw ApiException(HttpStatus.SERVICE_UNAVAILABLE,code,"内容服务暂时不可用")
internal fun JsonNode.objectFields(required: Set<String>, optional: Set<String> = emptySet(), pointer: String = "") {
    if(!isObject || required.any { !has(it) } || fieldNames().asSequence().any { it !in required && it !in optional })shape(pointer)
}
internal fun JsonNode.string(pointer: String): String {
    if(!isTextual)shape(pointer)
    val value=textValue();var i=0
    while(i<value.length) {
        val c=value[i++]
        if(c=='\u0000' || c.isLowSurrogate())invalid(pointer,"INVALID_TEXT")
        if(c.isHighSurrogate() && (i>=value.length || !value[i++].isLowSurrogate()))invalid(pointer,"INVALID_TEXT")
    }
    return value
}
internal fun JsonNode.uuid(pointer: String): UUID {
    val text=string(pointer)
    return runCatching { UUID.fromString(text) }.getOrNull()?.takeIf { it.toString()==text.lowercase(java.util.Locale.ROOT) } ?: shape(pointer)
}
internal fun JsonNode.version(): Long {
    if(!isIntegralNumber || !canConvertToLong())shape("/expectedVersion")
    return longValue().also { if(it !in 1..9007199254740991L)invalid("/expectedVersion") }
}
internal fun textLength(text: String) = text.codePointCount(0,text.length)
internal fun title(value: JsonNode,pointer: String = "/title",maximum: Int = 120): String {
    val text=Normalizer.normalize(value.string(pointer).trim(),Normalizer.Form.NFC)
    if(textLength(text) !in 1..maximum || text.any { it.code<32 || it.code==127 })invalid(pointer)
    return text
}
internal fun status(value: JsonNode): String = value.string("/status").also { if(it !in setOf("ACTIVE","INACTIVE"))invalid("/status") }
internal data class ValidatedPayload(val payload: JsonNode,val optionIds: List<UUID>,val attachments: List<Pair<String,UUID>>,val searchText: String)

@Component
class ContentValidation(private val mapper: ObjectMapper) {
    private val commands=setOf("frac","sqrt","mathrm","mathbf","mathit","mathbb","operatorname","text","left","right","sum","prod","int","lim","log","ln","sin","cos","tan","alpha","beta","gamma","delta","theta","lambda","mu","pi","sigma","phi","omega","Delta","Gamma","Omega","cdot","times","div","pm","le","ge","neq","infty")
    fun request(op: String, input: JsonNode) {
        val required=when(op) {
            "contentCreateSubject" -> setOf("source","title")
            "contentUpdateSubject" -> setOf("expectedVersion","title","description")
            "contentSetSubjectStatus","contentSetQuestionStatus" -> setOf("expectedVersion","status")
            "contentCreateChapter" -> setOf("expectedVersion","title")
            "contentUpdateChapter" -> setOf("expectedVersion","title","status")
            "contentReorderChapters","contentReorderQuestions" -> setOf("expectedVersion","ids")
            "contentCreateQuestion" -> setOf("expectedVersion","question")
            "contentReviseQuestion" -> setOf("expectedVersion","content")
            "contentPrevalidateImport" -> setOf("expectedVersion","documents")
            "contentCommitImport","contentCancelImport" -> setOf("expectedVersion")
            else -> error("Unknown Content operation")
        }
        input.objectFields(required,if(op=="contentCreateSubject")setOf("description") else emptySet())
        input.get("expectedVersion")?.version()
        input.get("status")?.let(::status)
        input.get("title")?.let(::title)
        input.get("description")?.let { if(textLength(it.string("/description"))>2000)invalid("/description") }
        input.get("source")?.let { if(it.string("/source") !in setOf("SCHOOL","USER"))invalid("/source") }
        input.get("ids")?.let { ids ->
            if(!ids.isArray)shape("/ids")
            if(ids.size() !in 1..10000 || ids.map { it.uuid("/ids") }.distinct().size!=ids.size())invalid("/ids")
        }
        input.get("question")?.let { questionShape(it,"/question") }
        input.get("content")?.let { contentShape(it,"/content") }
        input.get("documents")?.let { docs ->
            if(!docs.isArray)shape("/documents")
            if(docs.size() !in 1..20)invalid("/documents")
            var total=0
            docs.forEachIndexed { index,doc ->
                val path="/documents/$index"
                doc.objectFields(setOf("fileName","schemaVersion","chapterId","questions"),pointer=path)
                val name=title(doc["fileName"],"$path/fileName")
                if(name in setOf(".","..") || name.any { it=='/' || it=='\\' })invalid("$path/fileName")
                if(doc["schemaVersion"].string("$path/schemaVersion")!="qanda-content-1")invalid("$path/schemaVersion","UNSUPPORTED_IMPORT_SCHEMA")
                doc["chapterId"].uuid("$path/chapterId")
                val questions=doc["questions"];if(!questions.isArray)shape("$path/questions")
                if(questions.size() !in 1..1000)invalid("$path/questions","CONTENT_LIMIT")
                total+=questions.size();questions.forEachIndexed { i,q -> questionShape(q,"$path/questions/$i") }
            }
            if(total !in 1..1000)invalid("/documents","CONTENT_LIMIT")
        }
    }
    private fun questionShape(q: JsonNode,p: String) {
        q.objectFields(setOf("sourceKey","content"),pointer=p)
        q.get("sourceKey")?.takeUnless { it.isNull }?.string("$p/sourceKey")
        contentShape(q["content"],"$p/content")
    }
    private fun contentShape(c: JsonNode,p: String) {
        val type=c.get("type")?.string("$p/type") ?: shape(p)
        val extra=when(type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> setOf("options","correctOptionKeys")
            "TRUE_FALSE" -> setOf("correctValue")
            "SHORT_ANSWER" -> setOf("referenceAnswer")
            else -> invalid("$p/type")
        }
        c.objectFields(setOf("type","stem","explanation")+extra,pointer=p)
        documentShape(c["stem"],"$p/stem")
        if(!c["explanation"].isNull)documentShape(c["explanation"],"$p/explanation")
        when(type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> {
                if(!c["options"].isArray || !c["correctOptionKeys"].isArray)shape(p)
                c["options"].forEachIndexed { i,o ->
                    val op="$p/options/$i";o.objectFields(setOf("key","optionId","content"),pointer=op)
                    o["key"].string("$op/key");if(!o["optionId"].isNull)o["optionId"].uuid("$op/optionId")
                    documentShape(o["content"],"$op/content")
                }
                c["correctOptionKeys"].forEach { it.string("$p/correctOptionKeys") }
            }
            "TRUE_FALSE" -> if(!c["correctValue"].isBoolean)shape("$p/correctValue")
            else -> documentShape(c["referenceAnswer"],"$p/referenceAnswer")
        }
    }
    private fun documentShape(d: JsonNode,p: String) {
        d.objectFields(setOf("blocks"),pointer=p)
        if(!d["blocks"].isArray)shape("$p/blocks")
        d["blocks"].forEachIndexed { i,b ->
            val bp="$p/blocks/$i"
            when(b.get("kind")?.asText()) {
                "TEXT" -> { b.objectFields(setOf("kind","text","format"),pointer=bp);b["text"].string("$bp/text");b["format"].string("$bp/format") }
                "IMAGE" -> { b.objectFields(setOf("kind","fileId","alt"),pointer=bp);b["fileId"].uuid("$bp/fileId");b["alt"].string("$bp/alt") }
                "LATEX" -> { b.objectFields(setOf("kind","source","display"),pointer=bp);b["source"].string("$bp/source");if(!b["display"].isBoolean)shape("$bp/display") }
                else -> invalid("$bp/kind")
            }
        }
    }
    fun sourceKey(q: JsonNode): String? = q.get("sourceKey")?.takeUnless { it.isNull }?.let { title(it,"/sourceKey") }
    internal fun payload(input: JsonNode,existingOptionIds: Set<UUID>? = null): ValidatedPayload {
        contentShape(input,"/content")
        val output=input.deepCopy<ObjectNode>();val type=QuestionType.valueOf(input["type"].asText())
        val options=mutableListOf<UUID>()
        if(type in setOf(QuestionType.SINGLE_CHOICE,QuestionType.MULTIPLE_CHOICE)) {
            val items=input["options"];if(items.size() !in 2..20)invalid("/content/options")
            val keys=items.map { it["key"].asText() }
            if(keys.distinct().size!=keys.size || keys.any { !it.matches(Regex("[A-Za-z0-9_-]{1,32}")) })invalid("/content/options")
            val ids=items.map { if(it["optionId"].isNull)UUID.randomUUID() else it["optionId"].uuid("/content/options/optionId").also { id -> if(existingOptionIds==null || id !in existingOptionIds)invalid("/content/options/optionId","INVALID_OPTION_ID") } }
            if(ids.distinct().size!=ids.size)invalid("/content/options","INVALID_OPTION_ID")
            val correct=input["correctOptionKeys"].map { it.asText() }
            if(correct.distinct().size!=correct.size || correct.any { it !in keys } || (type==QuestionType.SINGLE_CHOICE && correct.size!=1) || (type==QuestionType.MULTIPLE_CHOICE && correct.size !in 2..20))invalid("/content/correctOptionKeys")
            output.remove(listOf("options","correctOptionKeys"))
            output.set<JsonNode>("options",mapper.valueToTree(items.mapIndexed { i,o -> mapOf("optionId" to ids[i],"content" to o["content"]) }))
            output.set<JsonNode>("correctOptionIds",mapper.valueToTree(correct.map { ids[keys.indexOf(it)] }))
            options+=ids
        }
        val attachments=mutableListOf<Pair<String,UUID>>();val search=mutableListOf<String>()
        fun document(d: JsonNode,p: String) {
            if(d["blocks"].size() !in 1..100 || mapper.writeValueAsBytes(d).size>65536)invalid(p,"CONTENT_LIMIT")
            d["blocks"].forEachIndexed { i,b ->
                val bp="$p/blocks/$i"
                when(b["kind"].asText()) {
                    "TEXT" -> {
                        val text=b["text"].asText();if(textLength(text) !in 1..10000)invalid("$bp/text")
                        val format=b["format"].asText();if(format !in setOf("PLAIN","MARKDOWN"))invalid("$bp/format")
                        if(format=="MARKDOWN")RestrictedMarkdown.validate(text,"$bp/text")
                        search+=text
                    }
                    "IMAGE" -> { if(textLength(b["alt"].asText()) !in 1..500)invalid("$bp/alt");attachments+=("$bp/fileId" to b["fileId"].uuid("$bp/fileId")) }
                    "LATEX" -> { latex(b["source"].asText(),"$bp/source");search+=b["source"].asText() }
                }
            }
        }
        document(output["stem"],"/stem")
        output.get("options")?.forEachIndexed { i,o -> document(o["content"],"/options/$i/content") }
        output.get("referenceAnswer")?.let { document(it,"/referenceAnswer") }
        output.get("explanation")?.takeUnless { it.isNull }?.let { document(it,"/explanation") }
        if(attachments.size>20 || mapper.writeValueAsBytes(output).size>262144)invalid("/content","CONTENT_LIMIT")
        return ValidatedPayload(output,options,attachments,search.joinToString("\n").lowercase(java.util.Locale.ROOT))
    }
    internal fun latex(text: String,p: String) {
        if(textLength(text) !in 1..4000)invalid(p,"UNSAFE_LATEX")
        val env=ArrayDeque<String>();var depth=0;var i=0
        while(i<text.length) {
            when(val c=text[i++]) {
                '{' -> { depth++;if(depth+env.size>32)invalid(p,"UNSAFE_LATEX") }
                '}' -> { depth--;if(depth<0)invalid(p,"UNSAFE_LATEX") }
                '\\' -> {
                    if(i==text.length)invalid(p,"UNSAFE_LATEX")
                    if(!text[i].isLetter()) { if(text[i++] !in " ,;!{}_ %\\")invalid(p,"UNSAFE_LATEX");continue }
                    val start=i;while(i<text.length && text[i].isLetter())i++
                    val command=text.substring(start,i)
                    if(command in setOf("begin","end")) {
                        if(i>=text.length || text[i]!='{')invalid(p,"UNSAFE_LATEX")
                        val close=text.indexOf('}',i);if(close<0)invalid(p,"UNSAFE_LATEX")
                        val name=text.substring(i+1,close);i=close+1
                        if(name !in setOf("matrix","pmatrix","bmatrix","cases","aligned"))invalid(p,"UNSAFE_LATEX")
                        if(command=="begin") { env.addLast(name);if(depth+env.size>32)invalid(p,"UNSAFE_LATEX") }
                        else if(env.isEmpty() || env.removeLast()!=name)invalid(p,"UNSAFE_LATEX")
                    } else if(command !in commands)invalid(p,"UNSAFE_LATEX")
                }
                else -> if(c.code<32 && c !in "\n\r\t")invalid(p,"UNSAFE_LATEX")
            }
        }
        if(depth!=0 || env.isNotEmpty())invalid(p,"UNSAFE_LATEX")
    }
}

/** Bounded grammar: paragraphs, emphasis, lists, tables and code; links/HTML have explicit rejected nodes. */
internal object RestrictedMarkdown {
    private enum class Kind { TEXT, CODE, HTML, LINK }
    private data class Node(val kind: Kind)
    fun validate(text: String,pointer: String) {
        val nodes=mutableListOf<Node>();var fence: String?=null
        for(line in text.lineSequence()) {
            val trimmed=line.trimStart()
            val marker=if(line.length-trimmed.length<=3)Regex("^(`{3,}|~{3,})(.*)$").find(trimmed) else null
            if(marker!=null) {
                val run=marker.groupValues[1];val rest=marker.groupValues[2]
                if(fence==null && (run.first()!='`' || '`' !in rest)) { fence=run;nodes+=Node(Kind.CODE);continue }
                if(fence!=null && run.first()==fence.first() && run.length>=fence.length && rest.isBlank()) { fence=null;nodes+=Node(Kind.CODE);continue }
            }
            if(fence!=null) { nodes+=Node(Kind.CODE);continue }
            var i=0
            while(i<line.length) {
                val c=line[i++]
                when(c) {
                    '\\' -> if(i<line.length)i++
                    '`' -> {
                        val start=i-1;while(i<line.length && line[i]=='`')i++
                        val ticks=line.substring(start,i);var end=line.indexOf(ticks,i)
                        while(end>=0 && (end>0 && line[end-1]=='`' || end+ticks.length<line.length && line[end+ticks.length]=='`'))end=line.indexOf(ticks,end+1)
                        if(end>=0)i=end+ticks.length
                        nodes+=Node(Kind.CODE)
                    }
                    '<' -> { if(i<line.length && (line[i].isLetter() || line[i] in "!/?"))nodes+=Node(Kind.HTML) }
                    '[' -> {
                        // shortcut: unescaped brackets are excluded; adopt a CommonMark AST when literal bracket prose is required.
                        nodes+=Node(Kind.LINK)
                    }
                    else -> nodes+=Node(Kind.TEXT)
                }
            }
        }
        if(nodes.any { it.kind in setOf(Kind.HTML,Kind.LINK) })invalid(pointer,"UNSAFE_MARKDOWN")
    }
}
