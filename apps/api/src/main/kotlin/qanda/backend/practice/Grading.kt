package qanda.backend.practice

import qanda.backend.content.QuestionView
import qanda.backend.platform.http.invalid

object Grading {
    fun validate(question: QuestionView,answer: AnswerInput?) {
        if(answer==null) return
        when(question.type) {
            "SINGLE_CHOICE","MULTIPLE_CHOICE" -> {
                val keys=answer.optionKeys ?: invalid("/answer/optionKeys")
                if(keys.isEmpty() || keys.distinct().size!=keys.size || keys.any { k -> question.options.none { it.key==k } } || question.type=="SINGLE_CHOICE" && keys.size!=1 || answer.value!=null || answer.text!=null) invalid("/answer")
            }
            "TRUE_FALSE" -> if(answer.value==null || answer.optionKeys!=null || answer.text!=null) invalid("/answer")
            "SHORT_ANSWER" -> if(answer.text.isNullOrBlank() || answer.text.length>10000 || '\u0000' in answer.text || answer.optionKeys!=null || answer.value!=null) invalid("/answer")
        }
    }
    fun outcome(question: QuestionView,answer: AnswerInput?): String {
        if(answer==null) return "UNANSWERED"
        return when(question.type) {
            "SHORT_ANSWER" -> "SELF_RATED"
            "TRUE_FALSE" -> if(question.correctValue==answer.value) "CORRECT" else "WRONG"
            else -> if(question.correctAnswer!!.toSet()==answer.optionKeys!!.toSet()) "CORRECT" else "WRONG"
        }
    }
}
