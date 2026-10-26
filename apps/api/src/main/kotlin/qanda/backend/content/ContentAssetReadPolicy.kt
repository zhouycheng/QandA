package qanda.backend.content

import org.springframework.stereotype.Component
import qanda.backend.adminsecurity.api.AdminContext
import qanda.backend.authorization.AuthorizationService
import qanda.backend.authorization.api.*
import qanda.backend.content.api.ContentView
import qanda.backend.content.api.SubjectGuard
import qanda.backend.identity.api.AuthorizationIdentityGuards
import qanda.backend.platform.files.AssetAccessContext
import qanda.backend.platform.files.AssetReadPolicy
import java.time.Instant
import java.util.UUID

/** Created only after Content's actual current access decision; no HTTP constructor binding. */
class ContentFileAccessContext internal constructor(
    override val fileId: UUID,override val subjectId: UUID,
    internal val actor: AuthorizationActor,internal val accounts: AuthorizationIdentityGuards,
    internal val organizations: OrganizationGuards,internal val guard: SubjectGuard,
    internal val verdict: AccessVerdict,internal val admin: AdminContext?,
    internal val view: ContentView,internal val revisionId: UUID?,internal val verifiedAt: Instant,
) : AssetAccessContext

@Component
class ContentAssetReadPolicy(private val store: ContentStore,private val authorization: AuthorizationService): AssetReadPolicy {
    override fun supports(context: AssetAccessContext)=context is ContentFileAccessContext
    override fun validateReadInTransaction(context: AssetAccessContext,now: Instant) {
        val c=context as? ContentFileAccessContext ?: missing()
        c.guard.assertHeld();c.accounts.assertHeld(c.actor.accountId)
        check(c.guard.subjectId==c.subjectId && !c.verifiedAt.isAfter(now) && c.verifiedAt.plusSeconds(5).isAfter(now)) { "Image access requires a fresh transaction-bound context" }
        val descriptor=store.describeLocked(c.guard)
        val action=if(c.view==ContentView.LEARN)AccessAction.READ_CURRENT_CONTENT else if(descriptor.source==SubjectSource.SCHOOL)AccessAction.MANAGE_SCHOOL_CONTENT else AccessAction.EDIT_USER_CONTENT
        val fresh=authorization.evaluateLocked(c.actor,c.accounts,c.organizations,c.guard,descriptor,action,c.admin)
        check(fresh==c.verdict && fresh.allowed) { "Image access decision is stale" }
        if(c.view==ContentView.LEARN && c.revisionId==null)shape("/revisionId")
        if(store.row("SELECT file_id FROM content_image WHERE subject_id=? AND file_id=?",c.subjectId,c.fileId)==null)missing()
        if(c.revisionId!=null) {
            val current=if(c.view==ContentView.LEARN)" AND q.current_revision_id=r.id AND q.status='ACTIVE' AND ch.status='ACTIVE'" else ""
            if(store.row("""SELECT a.file_id FROM content_revision_attachment a JOIN content_question_revision r ON r.id=a.revision_id
                JOIN content_question q ON q.id=r.question_id JOIN content_chapter ch ON ch.id=q.chapter_id
                WHERE a.file_id=? AND a.revision_id=? AND q.subject_id=? $current LIMIT 1""",c.fileId,c.revisionId,c.subjectId)==null)missing()
        }
    }
}
