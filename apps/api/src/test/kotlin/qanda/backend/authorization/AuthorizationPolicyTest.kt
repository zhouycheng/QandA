package qanda.backend.authorization

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import qanda.backend.authorization.api.*
import java.util.UUID

class AuthorizationPolicyTest {
    private val school=SubjectAccessDescriptor(UUID.randomUUID(),SubjectSource.SCHOOL,null,"ACTIVE",true,true,true,1)
    @Test fun `all 32 school combinations follow union and inheritance only blocking`() {
        var permitted=0
        for(mask in 0..31) {
            val p=mask and 1!=0;val g=mask and 2!=0;val c=mask and 4!=0;val m=mask and 8!=0;val b=mask and 16!=0
            val expected=when { p || g -> true; b -> false; else -> c || m }
            val actual=AuthorizationPolicy.evaluate(school,AccessAction.CREATE,1,AccessFacts(true,true,p,c,m,g,b))
            assertEquals(expected,actual.allowed,"mask=$mask")
            if(actual.allowed)permitted++
        }
        assertEquals(27,permitted)
    }
    @Test fun `retirement blocks new selection but not issued sessions and current denial wins`() {
        val retired=school.copy(status="INACTIVE",newSelectionAvailable=false,contentVersion=2)
        for(action in AccessAction.entries) {
            val facts=AccessFacts(true,true,publicGranted=true,administrator=true)
            val verdict=AuthorizationPolicy.evaluate(retired,action,1,facts)
            when(action) {
                in AuthorizationPolicy.newSelection -> { assertFalse(verdict.allowed);assertEquals("NEW_SELECTION_UNAVAILABLE",verdict.denialKind) }
                in AuthorizationPolicy.issued -> assertTrue(verdict.allowed)
                AccessAction.MANAGE_SCHOOL_CONTENT -> assertTrue(verdict.allowed)
                else -> assertFalse(verdict.allowed)
            }
        }
        val revoked=AuthorizationPolicy.evaluate(retired,AccessAction.CONTINUE_FIXED_SESSION,2,AccessFacts(true,true))
        assertEquals("ACCESS_DENIED",revoked.denialKind)
    }
    @Test fun `private subject requires owner or explicit recipient and admin cannot bypass`() {
        val user=school.copy(source=SubjectSource.USER,ownerAccountId=UUID.randomUUID())
        assertFalse(AuthorizationPolicy.evaluate(user,AccessAction.CREATE,1,AccessFacts(true,true,publicGranted=true,administrator=true)).allowed)
        assertTrue(AuthorizationPolicy.evaluate(user,AccessAction.CREATE,1,AccessFacts(true,true,shared=true)).allowed)
        assertFalse(AuthorizationPolicy.evaluate(user,AccessAction.EDIT_USER_CONTENT,1,AccessFacts(true,true,shared=true)).allowed)
        assertTrue(AuthorizationPolicy.evaluate(user,AccessAction.MANAGE_USER_SHARES,1,AccessFacts(false,false,owner=true)).allowed)
        assertFalse(AuthorizationPolicy.evaluate(user,AccessAction.CREATE,1,AccessFacts(false,false,owner=true)).allowed)
    }
}
