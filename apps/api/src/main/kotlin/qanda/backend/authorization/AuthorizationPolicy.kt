package qanda.backend.authorization

import qanda.backend.authorization.api.*
import java.util.UUID

internal data class AccessFacts(
    val hasMembership:Boolean, val organizationActive:Boolean,
    val publicGranted:Boolean = false, val collegeGranted:Boolean = false, val majorGranted:Boolean = false,
    val explicitGranted:Boolean = false, val inheritanceBlocked:Boolean = false,
    val owner:Boolean = false, val shared:Boolean = false, val administrator:Boolean = false,
)

internal object AuthorizationPolicy {
    val newSelection = setOf(AccessAction.CREATE,AccessAction.READ_CURRENT_CONTENT,AccessAction.SELECT_WRONG_REVIEW)
    val issued = setOf(AccessAction.CONTINUE_FIXED_SESSION,AccessAction.READ_FIXED_SESSION_RESULT,AccessAction.READ_LEARNING_HISTORY)
    val management = setOf(AccessAction.EDIT_USER_CONTENT,AccessAction.MANAGE_USER_SHARES,AccessAction.MANAGE_SCHOOL_CONTENT)
    fun evaluate(descriptor:SubjectAccessDescriptor,action:AccessAction,policyVersion:Long,facts:AccessFacts):AccessVerdict {
        val resource = when(action) {
            in newSelection -> descriptor.newSelectionAvailable
            in issued -> descriptor.issuedVersionReadAvailable
            else -> descriptor.ownerManagementAvailable
        }
        val reason = when {
            action==AccessAction.MANAGE_SCHOOL_CONTENT -> if(descriptor.source==SubjectSource.SCHOOL && facts.administrator) "ADMIN" else "ADMIN_REQUIRED"
            action in management -> if(descriptor.source==SubjectSource.USER && facts.owner) "OWNER" else "OWNER_REQUIRED"
            !facts.hasMembership -> "MEMBERSHIP_REQUIRED"
            descriptor.source==SubjectSource.USER -> when { facts.owner -> "OWNER"; facts.shared -> "SHARE"; else -> "NO_GRANT" }
            facts.publicGranted -> "PUBLIC"
            facts.explicitGranted -> "EXPLICIT"
            facts.organizationActive && (facts.collegeGranted || facts.majorGranted) && facts.inheritanceBlocked -> "INHERITANCE_BLOCKED"
            facts.organizationActive && facts.collegeGranted -> "COLLEGE"
            facts.organizationActive && facts.majorGranted -> "MAJOR"
            else -> "NO_GRANT"
        }
        val granted=reason in setOf("ADMIN","OWNER","SHARE","PUBLIC","EXPLICIT","COLLEGE","MAJOR")
        val denial=when {
            !granted -> if(reason=="MEMBERSHIP_REQUIRED") "MEMBERSHIP_REQUIRED" else "ACCESS_DENIED"
            resource -> null
            action in newSelection -> "NEW_SELECTION_UNAVAILABLE"
            action in issued -> "ISSUED_CONTENT_UNAVAILABLE"
            else -> "MANAGEMENT_UNAVAILABLE"
        }
        val finalReason=when(denial) { "NEW_SELECTION_UNAVAILABLE" -> "CONTENT_SELECTION_UNAVAILABLE"; "ISSUED_CONTENT_UNAVAILABLE" -> "ISSUED_CONTENT_UNAVAILABLE"; "MANAGEMENT_UNAVAILABLE" -> "CONTENT_MANAGEMENT_UNAVAILABLE"; else -> reason }
        return AccessVerdict(descriptor.id,descriptor.source,action,granted,resource,granted && resource,denial,finalReason,policyVersion,descriptor.contentVersion)
    }

    fun scope(accountId:UUID,member:Membership?,action:AccessAction,admin:Boolean):AuthorizedSubjectScope {
        if(action in management) {
            val access=if(action==AccessAction.MANAGE_SCHOOL_CONTENT) {
                if(admin) "s.source='SCHOOL'" else "FALSE"
            } else "(s.source='USER' AND s.owner_account_id=?)"
            return AuthorizedSubjectScope(access,if(action==AccessAction.MANAGE_SCHOOL_CONTENT) emptyList() else listOf(accountId),action)
        }
        if(member==null)return AuthorizedSubjectScope("FALSE",emptyList(),action)
        val availability=if(action in newSelection) " AND s.status='ACTIVE'" else ""
        val sql="""EXISTS(SELECT 1 FROM authz_subject_policy ap WHERE ap.subject_id=s.id AND (
            (s.source='USER' AND (s.owner_account_id=? OR EXISTS(SELECT 1 FROM authz_user_share sh WHERE sh.subject_id=s.id AND sh.recipient_account_id=?))) OR
            (s.source='SCHOOL' AND (ap.is_public OR EXISTS(SELECT 1 FROM authz_account_rule r WHERE r.subject_id=s.id AND r.account_id=? AND r.granted) OR
            (? AND (EXISTS(SELECT 1 FROM authz_college_grant cg WHERE cg.subject_id=s.id AND cg.college_id=?) OR EXISTS(SELECT 1 FROM authz_major_grant mg WHERE mg.subject_id=s.id AND mg.major_id=?))
            AND NOT EXISTS(SELECT 1 FROM authz_account_rule r WHERE r.subject_id=s.id AND r.account_id=? AND r.inheritance_blocked))))))$availability"""
        return AuthorizedSubjectScope(sql,listOf(accountId,accountId,accountId,member.organizationActive,member.collegeId,member.majorId,accountId),action)
    }
}
