package qanda.backend.content

import com.fasterxml.jackson.databind.JsonNode
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.*
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.servlet.HandlerMapping
import qanda.backend.authorization.api.SubjectSource
import qanda.backend.content.api.*
import qanda.backend.platform.http.*
import java.util.UUID

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
class ContentBodyLimit(private val errors: ErrorWriter): OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest,response: HttpServletResponse,chain: FilterChain) {
        if(request.requestURI.startsWith("/api/v1/subjects") && request.contentType?.substringBefore(';')?.trim()?.lowercase()=="application/json" && RequestBodies.bytes(request).size>5242880) {
            response.setHeader("Cache-Control","no-store")
            errors.write(request,response,ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"PAYLOAD_TOO_LARGE","内容请求超过5MiB限制"));return
        }
        chain.doFilter(request,response)
    }
}

@RestController
@RequestMapping("/api/v1/subjects")
class ContentController(private val service: ContentService,private val validation: ContentValidation) {
    @ModelAttribute
    fun validateRoute(req: HttpServletRequest) {
        @Suppress("UNCHECKED_CAST")
        val variables=req.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) as? Map<String,String> ?: emptyMap()
        variables.forEach { (name,value) -> if(!value.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")))shape("/$name") }
        val route=req.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE).toString()
        val allowed=if(req.method!="GET")emptySet() else when(route) {
            "/api/v1/subjects" -> setOf("view","source","page","pageSize")
            "/api/v1/subjects/{subjectId}" -> setOf("view")
            "/api/v1/subjects/{subjectId}/chapters" -> setOf("view","page","pageSize")
            "/api/v1/subjects/{subjectId}/chapters/{chapterId}/questions" -> setOf("view","type","page","pageSize")
            "/api/v1/subjects/{subjectId}/questions/{questionId}" -> setOf("view")
            "/api/v1/subjects/{subjectId}/question-search" -> setOf("view","type","q","page","pageSize")
            "/api/v1/subjects/{subjectId}/images/{fileId}" -> setOf("view","revisionId")
            else -> emptySet()
        }
        req.parameterMap.forEach { (name,values) -> if(name !in allowed || values.size!=1 || values.single().isEmpty())shape("/$name") }
        req.getParameter("revisionId")?.let { if(!it.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")))shape("/revisionId") }
    }
    private fun command(op: String,req: HttpServletRequest,res: HttpServletResponse,input: JsonNode? = null,bytes: ByteArray? = null): ContentCommand {
        if(req.parameterMap.isNotEmpty())shape()
        val key=req.getHeaders("Idempotency-Key").toList().singleOrNull()?.let { raw -> runCatching { UUID.fromString(raw) }.getOrNull()?.takeIf { it.toString()==raw.lowercase(java.util.Locale.ROOT) } }
            ?: throw ApiException(HttpStatus.BAD_REQUEST,"INVALID_IDEMPOTENCY_KEY","请提供一个有效幂等键")
        val raw=bytes ?: RequestBodies.bytes(req)
        if(raw.size>5242880)throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"PAYLOAD_TOO_LARGE","内容请求超过5MiB限制")
        if(input!=null)validation.request(op,input)
        res.setHeader("Idempotency-Key",key.toString())
        return ContentCommand(op,key,RequestIds.get(req),req.method,req.requestURI,req.contentType.substringBefore(';').trim().lowercase(),raw)
    }
    @GetMapping
    fun contentListSubjects(@RequestParam(defaultValue="LEARN") view: ContentView,@RequestParam(required=false) source: SubjectSource?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int)=service.listSubjects(view,source,page,pageSize)
    @PostMapping(consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun contentCreateSubject(@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.createSubject(input,command("contentCreateSubject",req,res,input))
    @GetMapping("/{subjectId}")
    fun contentGetSubject(@PathVariable subjectId: UUID,@RequestParam(defaultValue="LEARN") view: ContentView)=service.getSubject(subjectId,view)
    @PutMapping("/{subjectId}",consumes=["application/json"])
    fun contentUpdateSubject(@PathVariable subjectId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.updateSubject(subjectId,input,command("contentUpdateSubject",req,res,input))
    @PutMapping("/{subjectId}/status",consumes=["application/json"])
    fun contentSetSubjectStatus(@PathVariable subjectId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.updateSubject(subjectId,input,command("contentSetSubjectStatus",req,res,input),true)
    @GetMapping("/{subjectId}/chapters")
    fun contentListChapters(@PathVariable subjectId: UUID,@RequestParam(defaultValue="LEARN") view: ContentView,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int)=service.listChapters(subjectId,view,page,pageSize)
    @PostMapping("/{subjectId}/chapters",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun contentCreateChapter(@PathVariable subjectId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.createChapter(subjectId,input,command("contentCreateChapter",req,res,input))
    @PutMapping("/{subjectId}/chapters/{chapterId}",consumes=["application/json"])
    fun contentUpdateChapter(@PathVariable subjectId: UUID,@PathVariable chapterId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.updateChapter(subjectId,chapterId,input,command("contentUpdateChapter",req,res,input))
    @PutMapping("/{subjectId}/chapter-order",consumes=["application/json"])
    fun contentReorderChapters(@PathVariable subjectId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.reorder(subjectId,null,input,command("contentReorderChapters",req,res,input))
    @GetMapping("/{subjectId}/chapters/{chapterId}/questions")
    fun contentListQuestions(@PathVariable subjectId: UUID,@PathVariable chapterId: UUID,@RequestParam(defaultValue="LEARN") view: ContentView,@RequestParam(required=false) type: QuestionType?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int)=service.listQuestions(subjectId,chapterId,view,type,page,pageSize)
    @PostMapping("/{subjectId}/chapters/{chapterId}/questions",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun contentCreateQuestion(@PathVariable subjectId: UUID,@PathVariable chapterId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.createQuestion(subjectId,chapterId,input,command("contentCreateQuestion",req,res,input))
    @PutMapping("/{subjectId}/chapters/{chapterId}/question-order",consumes=["application/json"])
    fun contentReorderQuestions(@PathVariable subjectId: UUID,@PathVariable chapterId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.reorder(subjectId,chapterId,input,command("contentReorderQuestions",req,res,input))
    @GetMapping("/{subjectId}/questions/{questionId}")
    fun contentGetQuestion(@PathVariable subjectId: UUID,@PathVariable questionId: UUID,@RequestParam(defaultValue="LEARN") view: ContentView)=service.getQuestion(subjectId,questionId,view)
    @PutMapping("/{subjectId}/questions/{questionId}",consumes=["application/json"])
    fun contentReviseQuestion(@PathVariable subjectId: UUID,@PathVariable questionId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.reviseQuestion(subjectId,questionId,input,command("contentReviseQuestion",req,res,input))
    @PutMapping("/{subjectId}/questions/{questionId}/status",consumes=["application/json"])
    fun contentSetQuestionStatus(@PathVariable subjectId: UUID,@PathVariable questionId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.reviseQuestion(subjectId,questionId,input,command("contentSetQuestionStatus",req,res,input),true)
    @GetMapping("/{subjectId}/questions/{questionId}/revisions/{revisionId}")
    fun contentGetManagedRevision(@PathVariable subjectId: UUID,@PathVariable questionId: UUID,@PathVariable revisionId: UUID)=service.getRevision(subjectId,questionId,revisionId)
    @GetMapping("/{subjectId}/question-search")
    fun contentSearchQuestions(@PathVariable subjectId: UUID,@RequestParam q: String,@RequestParam(defaultValue="LEARN") view: ContentView,@RequestParam(required=false) type: QuestionType?,@RequestParam(defaultValue="1") page: Int,@RequestParam(defaultValue="20") pageSize: Int)=service.searchQuestions(subjectId,q,view,type,page,pageSize)
    @PostMapping("/{subjectId}/imports",consumes=["application/json"]) @ResponseStatus(HttpStatus.CREATED)
    fun contentPrevalidateImport(@PathVariable subjectId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.prevalidateImport(subjectId,input,command("contentPrevalidateImport",req,res,input))
    @GetMapping("/{subjectId}/imports/{importId}")
    fun contentGetImport(@PathVariable subjectId: UUID,@PathVariable importId: UUID)=service.getImport(subjectId,importId)
    @PostMapping("/{subjectId}/imports/{importId}/commit",consumes=["application/json"])
    fun contentCommitImport(@PathVariable subjectId: UUID,@PathVariable importId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.importAction(subjectId,importId,input,command("contentCommitImport",req,res,input),true)
    @PostMapping("/{subjectId}/imports/{importId}/cancel",consumes=["application/json"])
    fun contentCancelImport(@PathVariable subjectId: UUID,@PathVariable importId: UUID,@RequestBody input: JsonNode,req: HttpServletRequest,res: HttpServletResponse)=service.importAction(subjectId,importId,input,command("contentCancelImport",req,res,input),false)
    @PostMapping("/{subjectId}/images",consumes=["image/png","image/jpeg","image/webp"]) @ResponseStatus(HttpStatus.CREATED)
    fun contentUploadImage(@PathVariable subjectId: UUID,req: HttpServletRequest,res: HttpServletResponse): ImageView {
        // Consume the bounded first rejected byte so a 5MiB+1 request can receive its 413 response.
        val bytes=req.inputStream.readNBytes(5242881)
        if(bytes.isEmpty())invalid("","INVALID_IMAGE")
        val image=service.uploadImage(subjectId,command("contentUploadImage",req,res,bytes=bytes))
        res.setHeader("Cache-Control","private, no-store")
        return image
    }
    @GetMapping("/{subjectId}/images/{fileId}")
    fun contentReadImage(@PathVariable subjectId: UUID,@PathVariable fileId: UUID,@RequestParam(defaultValue="LEARN") view: ContentView,@RequestParam(required=false) revisionId: UUID?,res: HttpServletResponse): ResponseEntity<ByteArray> {
        val (metadata,bytes)=service.readImage(subjectId,fileId,view,revisionId)
        res.setHeader("Cache-Control","private, no-store")
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(metadata.mediaType)).contentLength(bytes.size.toLong()).header("X-Content-Type-Options","nosniff").body(bytes)
    }
}
