package qanda.backend.content

import qanda.backend.platform.http.invalid

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
