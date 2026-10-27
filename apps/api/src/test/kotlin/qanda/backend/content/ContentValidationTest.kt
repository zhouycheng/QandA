package qanda.backend.content

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import qanda.backend.platform.http.ApiException
import java.util.UUID

class ContentValidationTest {
    private val mapper=jacksonObjectMapper()
    private val validation=ContentValidation(mapper)
    private fun doc(text: String="中文 e\u0301 🌊\n第二行",format: String="PLAIN")=mapOf("blocks" to listOf(mapOf("kind" to "TEXT","text" to text,"format" to format)))
    private fun content(type: String="SINGLE_CHOICE"): JsonNode=mapper.valueToTree(linkedMapOf<String,Any?>("type" to type,"stem" to doc(),"explanation" to null).apply {
        when(type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> { put("options",listOf("a","b").map { mapOf("key" to it,"optionId" to null,"content" to doc(it)) });put("correctOptionKeys",if(type=="SINGLE_CHOICE")listOf("a") else listOf("a","b")) }
            "TRUE_FALSE" -> put("correctValue",true)
            "SHORT_ANSWER" -> put("referenceAnswer",doc("参考答案"))
        }
    })
    private fun rejected(code: String="VALIDATION_FAILED",block: ()->Unit)=assertThrows(ApiException::class.java,block).also { assertEquals(code,it.code) }
    @Test fun `all four payloads preserve Unicode and choice answer identities`() {
        for(type in listOf("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER")) {
            val input=content(type);val value=validation.payload(input)
            assertEquals(input["stem"],value.payload["stem"])
            assertEquals(type,value.payload["type"].asText())
            if(type.endsWith("CHOICE")) {
                assertEquals(2,value.optionIds.size);assertTrue(value.payload["correctOptionIds"].all { id -> value.optionIds.any { it.toString()==id.asText() } })
                assertFalse(value.payload.has("correctOptionKeys"))
            }
        }
    }
    @Test fun `stable options belong to the question and duplicate or unknown answers fail`() {
        val original=content();val id=UUID.randomUUID()
        (original["options"][0] as com.fasterxml.jackson.databind.node.ObjectNode).put("optionId",id.toString())
        rejected("INVALID_OPTION_ID") { validation.payload(original) }
        assertEquals(id.toString(),validation.payload(original,setOf(id)).payload["options"][0]["optionId"].asText())
        rejected("INVALID_OPTION_ID") { validation.payload(original,setOf(UUID.randomUUID())) }
        (original["correctOptionKeys"] as com.fasterxml.jackson.databind.node.ArrayNode).removeAll().add("unknown")
        rejected { validation.payload(original,setOf(id)) }
    }
    @Test fun `JSON boundaries reject unknown fields non boolean true and non numeric versions`() {
        for(raw in listOf("{\"expectedVersion\":\"1\",\"status\":\"ACTIVE\"}","{\"expectedVersion\":true,\"status\":\"ACTIVE\"}","{\"expectedVersion\":1,\"status\":\"ACTIVE\",\"extra\":0}"))rejected("INVALID_REQUEST") { validation.request("contentSetSubjectStatus",mapper.readTree(raw)) }
        val bad=content("TRUE_FALSE");(bad as com.fasterxml.jackson.databind.node.ObjectNode).put("correctValue","true")
        rejected("INVALID_REQUEST") { validation.payload(bad) }
        val missing=content();(missing as com.fasterxml.jackson.databind.node.ObjectNode).remove("explanation")
        rejected("INVALID_REQUEST") { validation.payload(missing) }
    }
    @Test fun `unsupported Unicode and required source key are rejected before persistence`() {
        for(text in listOf("\u0000","\uD800","\uDC00"))rejected("INVALID_TEXT") { mapper.nodeFactory.textNode(text).string("/text") }
        val input=mapper.valueToTree<JsonNode>(mapOf("expectedVersion" to 1,"question" to mapOf("content" to content())))
        rejected("INVALID_REQUEST") { validation.request("contentCreateQuestion",input) }
    }
    @Test fun `document byte limits image count and payload aggregate are enforced`() {
        val oversized=content("SHORT_ANSWER")
        (oversized as com.fasterxml.jackson.databind.node.ObjectNode).set<JsonNode>("referenceAnswer",mapper.valueToTree(mapOf("blocks" to List(10){mapOf("kind" to "TEXT","text" to "中".repeat(3000),"format" to "PLAIN")})))
        rejected("CONTENT_LIMIT") { validation.payload(oversized) }
        val images=content("TRUE_FALSE")
        (images as com.fasterxml.jackson.databind.node.ObjectNode).set<JsonNode>("stem",mapper.valueToTree(mapOf("blocks" to List(21){mapOf("kind" to "IMAGE","fileId" to UUID.randomUUID(),"alt" to "图")})))
        rejected("CONTENT_LIMIT") { validation.payload(images) }
    }
    @Test fun `LaTex parser validates matched environments bounded nesting and command allowlist`() {
        validation.latex("\\begin{aligned}a&=\\frac{1}{2}\\\\b&=\\sqrt{2}\\end{aligned}","/latex")
        for(text in listOf("\\input{secret}","\\href{bad}{x}","\\begin{matrix}x\\end{cases}","{".repeat(33)+"x"+"}".repeat(33),"\\unknown", "{"))rejected("UNSAFE_LATEX") { validation.latex(text,"/latex") }
    }
    @Test fun `Markdown syntax rejects active HTML links images and accepts escaped literal code`() {
        for(text in listOf("<script>x</script>","[x](https://example.test)","![x](data:image/png;base64,a)","<https://example.test>","- item\n    <script>x</script>","```a`b\n<script>x</script>","`<script>x</script>``"))rejected("UNSAFE_MARKDOWN") { RestrictedMarkdown.validate(text,"/text") }
        RestrictedMarkdown.validate("**重点**\n- 项目\n`a+b`\n\\[字面\\]","/text")
    }
}
