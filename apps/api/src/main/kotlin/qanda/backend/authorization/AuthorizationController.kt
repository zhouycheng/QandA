package qanda.backend.authorization

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*
import qanda.backend.authorization.api.*
import qanda.backend.platform.http.RequestBodies
import qanda.backend.platform.http.RequestIds
import java.util.UUID

@RestController
@RequestMapping("/api/v1")
class AuthorizationController(private val service:AuthorizationService) {
    private fun command(id:UUID,request:HttpServletRequest,response:HttpServletResponse):AuthorizationCommand {
        response.setHeader("Idempotency-Key",id.toString())
        return AuthorizationCommand(id,RequestIds.get(request),request.method,request.requestURI,request.contentType ?: "application/json",RequestBodies.bytes(request))
    }
    @GetMapping("/colleges")
    fun authorizationListSelectableColleges(@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int):Page<CollegeOption> {
        val p=service.listColleges(page,pageSize);return Page(p.items.map { CollegeOption(it.collegeId,it.name) },p.page,p.pageSize,p.totalItems)
    }
    @GetMapping("/colleges/{collegeId}/majors")
    fun authorizationListSelectableMajors(@PathVariable collegeId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int):Page<MajorOption> {
        val p=service.listMajors(collegeId,page,pageSize);return Page(p.items.map { MajorOption(it.majorId,it.collegeId,it.name) },p.page,p.pageSize,p.totalItems)
    }
    @GetMapping("/admin/colleges")
    fun authorizationAdminListColleges(@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listColleges(page,pageSize,true)
    @PostMapping("/admin/colleges",consumes=["application/json"])
    @ResponseStatus(HttpStatus.CREATED)
    fun authorizationCreateCollege(@Valid @RequestBody body:CreateOrganization,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.createCollege(body,command(key,request,response))
    @GetMapping("/admin/colleges/{collegeId}")
    fun authorizationAdminGetCollege(@PathVariable collegeId:UUID)=service.getCollege(collegeId)
    @PutMapping("/admin/colleges/{collegeId}",consumes=["application/json"])
    fun authorizationUpdateCollege(@PathVariable collegeId:UUID,@Valid @RequestBody body:UpdateOrganization,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.updateCollege(collegeId,body,command(key,request,response))
    @GetMapping("/admin/colleges/{collegeId}/majors")
    fun authorizationAdminListMajors(@PathVariable collegeId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listMajors(collegeId,page,pageSize,true)
    @PostMapping("/admin/colleges/{collegeId}/majors",consumes=["application/json"])
    @ResponseStatus(HttpStatus.CREATED)
    fun authorizationCreateMajor(@PathVariable collegeId:UUID,@Valid @RequestBody body:CreateOrganization,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.createMajor(collegeId,body,command(key,request,response))
    @GetMapping("/admin/majors/{majorId}")
    fun authorizationAdminGetMajor(@PathVariable majorId:UUID)=service.getMajor(majorId)
    @PutMapping("/admin/majors/{majorId}",consumes=["application/json"])
    fun authorizationUpdateMajor(@PathVariable majorId:UUID,@Valid @RequestBody body:UpdateOrganization,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.updateMajor(majorId,body,command(key,request,response))
    @GetMapping("/me/membership") fun authorizationGetOwnMembership()=service.getMembership()
    @PutMapping("/me/membership",consumes=["application/json"])
    fun authorizationSetOwnMembership(@Valid @RequestBody body:SetMembership,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setMembership(body,command(key,request,response))
    @GetMapping("/admin/accounts/{accountId}/membership") fun authorizationAdminGetMembership(@PathVariable accountId:UUID)=service.getMembership(accountId)
    @PutMapping("/admin/accounts/{accountId}/membership",consumes=["application/json"])
    fun authorizationAdminSetMembership(@PathVariable accountId:UUID,@Valid @RequestBody body:SetMembership,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setMembership(body,command(key,request,response),accountId)
    @GetMapping("/admin/accounts/{accountId}/membership-history")
    fun authorizationAdminListMembershipHistory(@PathVariable accountId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.membershipHistory(accountId,page,pageSize)
    @GetMapping("/admin/accounts/{accountId}/school-access")
    fun authorizationExplainAccountSchoolAccess(@PathVariable accountId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.explainSchoolAccess(accountId,page,pageSize)
    @GetMapping("/admin/subjects/{subjectId}/school-access") fun authorizationGetSchoolPolicy(@PathVariable subjectId:UUID)=service.getSchoolPolicy(subjectId)
    @PutMapping("/admin/subjects/{subjectId}/school-access",consumes=["application/json"])
    fun authorizationSetSchoolPublic(@PathVariable subjectId:UUID,@Valid @RequestBody body:SetPublic,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setSchoolPublic(subjectId,body,command(key,request,response))
    @GetMapping("/admin/subjects/{subjectId}/college-grants")
    fun authorizationListCollegeGrants(@PathVariable subjectId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listCollegeGrants(subjectId,page,pageSize)
    @PutMapping("/admin/subjects/{subjectId}/college-grants/{collegeId}",consumes=["application/json"])
    fun authorizationSetCollegeGrant(@PathVariable subjectId:UUID,@PathVariable collegeId:UUID,@Valid @RequestBody body:SetOrganizationGrant,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setOrganizationGrant(subjectId,collegeId,true,body,command(key,request,response))
    @GetMapping("/admin/subjects/{subjectId}/major-grants")
    fun authorizationListMajorGrants(@PathVariable subjectId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listMajorGrants(subjectId,page,pageSize)
    @PutMapping("/admin/subjects/{subjectId}/major-grants/{majorId}",consumes=["application/json"])
    fun authorizationSetMajorGrant(@PathVariable subjectId:UUID,@PathVariable majorId:UUID,@Valid @RequestBody body:SetOrganizationGrant,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setOrganizationGrant(subjectId,majorId,false,body,command(key,request,response))
    @GetMapping("/admin/subjects/{subjectId}/account-rules")
    fun authorizationListSchoolAccountRules(@PathVariable subjectId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listAccountRules(subjectId,page,pageSize)
    @PutMapping("/admin/subjects/{subjectId}/account-rules/{accountId}",consumes=["application/json"])
    fun authorizationSetSchoolAccountRule(@PathVariable subjectId:UUID,@PathVariable accountId:UUID,@Valid @RequestBody body:SetSchoolAccountRule,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.setAccountRule(subjectId,accountId,body,command(key,request,response))
    @GetMapping("/subjects/{subjectId}/shares")
    fun authorizationListUserSubjectShares(@PathVariable subjectId:UUID,@RequestParam(defaultValue="1") page:Int,@RequestParam(defaultValue="20") pageSize:Int)=service.listShares(subjectId,page,pageSize)
    @PostMapping("/subjects/{subjectId}/shares",consumes=["application/json"])
    fun authorizationGrantUserSubjectShare(@PathVariable subjectId:UUID,@Valid @RequestBody body:GrantUserShare,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.grantShare(subjectId,body,command(key,request,response))
    @PostMapping("/subjects/{subjectId}/share-revocations",consumes=["application/json"])
    fun authorizationRevokeUserSubjectShare(@PathVariable subjectId:UUID,@Valid @RequestBody body:RevokeUserShare,@RequestHeader("Idempotency-Key") key:UUID,request:HttpServletRequest,response:HttpServletResponse)=service.revokeShare(subjectId,body,command(key,request,response))
}
