package qanda.backend.content

import org.springframework.stereotype.Component
import qanda.backend.platform.security.Actor
import qanda.backend.platform.http.*

@Component
class ContentAccess(private val sql: ContentQueries,private val banks: QuestionBankMapper) {
    fun bank(actor: Actor,id: java.util.UUID,write: Boolean=false): QuestionBank {
        if(actor.kind=="USER") {
            if(write) forbidden()
            return sql.bank(id) ?: missing()
        }
        val bank=(if(write) sql.lockBank(id) else banks.selectById(id)) ?: missing()
        if(actor.role!="PLATFORM_ADMIN" && actor.id !in sql.maintainers(id)) missing()
        return bank
    }
}
