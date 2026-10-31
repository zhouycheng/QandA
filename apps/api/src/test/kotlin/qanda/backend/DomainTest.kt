package qanda.backend

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import qanda.backend.content.*
import qanda.backend.platform.config.BackendSafety
import qanda.backend.platform.http.ApiException
import qanda.backend.platform.http.RequestLimiter
import qanda.backend.practice.*
import java.util.UUID
import org.springframework.mock.env.MockEnvironment
import qanda.backend.platform.mail.LocalCaptureTransport

class DomainTest {
    private fun question(type: String,correct: List<String> = emptyList(),value: Boolean?=null)=QuestionView(UUID.randomUUID(),UUID.randomUUID(),null,"ACTIVE",1,UUID.randomUUID(),1,type,"题干",listOf(OptionInput("A","甲"),OptionInput("B","乙")),correct,value,"参考答案","解析",emptyList())
    @Test fun `objective grading is authoritative and short answers remain self rated`() {
        val multi=question("MULTIPLE_CHOICE",listOf("A","B"))
        Grading.validate(multi,AnswerInput(optionKeys=listOf("B","A")))
        assertEquals("CORRECT",Grading.outcome(multi,AnswerInput(optionKeys=listOf("B","A"))))
        assertEquals("WRONG",Grading.outcome(multi,AnswerInput(optionKeys=listOf("A"))))
        assertEquals("UNANSWERED",Grading.outcome(multi,null))
        assertEquals("CORRECT",Grading.outcome(question("TRUE_FALSE",value=false),AnswerInput(value=false)))
        assertEquals("SELF_RATED",Grading.outcome(question("SHORT_ANSWER"),AnswerInput(text="学生答案")))
        assertThrows(ApiException::class.java) { Grading.validate(multi,AnswerInput(optionKeys=listOf("X"))) }
        assertThrows(ApiException::class.java) { Grading.validate(question("SINGLE_CHOICE"),AnswerInput(optionKeys=listOf("A","B"))) }
        assertThrows(ApiException::class.java) { Grading.validate(question("SHORT_ANSWER"),AnswerInput(text="  ")) }
        assertThrows(ApiException::class.java) { Grading.validate(question("TRUE_FALSE"),AnswerInput(value=true,text="额外字段")) }
    }
    @Test fun `markdown keeps code inert and rejects active markup`() {
        RestrictedMarkdown.validate("普通内容 **重点**\n`<script>`\n```\n[x](bad)\n```","")
        for(value in listOf("<script>alert(1)</script>","[点击](javascript:alert(1))","![图片](https://example.test)")) assertThrows(ApiException::class.java) { RestrictedMarkdown.validate(value,"") }
    }
    @Test fun `database and local binding guards fail closed`() {
        BackendSafety("test","127.0.0.1","jdbc:postgresql://localhost:5432/qanda_backend","secret")
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("test","0.0.0.0","jdbc:postgresql://localhost:5432/qanda_backend","secret") }
        BackendSafety("local","0.0.0.0","jdbc:postgresql://postgres:5432/qanda_backend","secret",true)
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("local","192.0.2.1","jdbc:postgresql://postgres:5432/qanda_backend","secret",true) }
        assertThrows(IllegalArgumentException::class.java) { BackendSafety("local","127.0.0.1","jdbc:postgresql://localhost:5432/other","secret") }
    }
    @Test fun `request limiter expires entries and bounds memory`() {
        var now=0L;val limiter=RequestLimiter(1) { now }
        assertTrue(limiter.reserve("one",1));assertFalse(limiter.reserve("one",1));assertFalse(limiter.reserve("two",1))
        now=60_000_000_000L;assertTrue(limiter.reserve("two",1))
    }
    @Test fun `local capture accepts only loopback or the explicit container service`() {
        val environment=MockEnvironment().withProperty("qanda.backend.mode","local").withProperty("qanda.backend.mail.host","mailpit")
        assertThrows(IllegalArgumentException::class.java) { LocalCaptureTransport(environment) }
        LocalCaptureTransport(environment.withProperty("BACKEND_LOCAL_CONTAINER","true")).shutdown()
        assertThrows(IllegalArgumentException::class.java) { LocalCaptureTransport(environment.withProperty("qanda.backend.mail.host","example.test")) }
        assertThrows(IllegalArgumentException::class.java) { LocalCaptureTransport(environment.withProperty("qanda.backend.mode","production")) }
    }
}
