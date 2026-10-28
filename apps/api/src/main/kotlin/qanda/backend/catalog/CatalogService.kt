package qanda.backend.catalog

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import qanda.backend.platform.http.*
import java.time.Instant
import java.util.UUID

@Service
@Transactional
class CatalogService(private val colleges: CollegeMapper,private val majors: MajorMapper,private val subjects: SubjectMapper,private val sql: CatalogQueries) {
    fun collegeView(it: College)=CollegeView(it.id!!,it.name,it.code,it.status,it.version)
    fun majorView(it: Major)=MajorView(it.id!!,it.collegeId!!,it.name,it.code,it.status,it.version)
    fun subjectView(it: Subject)=SubjectView(it.id!!,it.name,it.description,it.status,it.version)
    fun colleges(p: PageSpec,admin: Boolean): Page<CollegeView> {
        val result=colleges.selectPage(com.baomidou.mybatisplus.extension.plugins.pagination.Page(p.page.toLong(),p.pageSize.toLong()),QueryWrapper<College>().eq(!admin,"status","ACTIVE").orderByAsc("name").orderByAsc("id"))
        return Page(result.records.map(::collegeView),result.total,p.page,p.pageSize)
    }
    fun majors(collegeId: UUID,p: PageSpec,admin: Boolean): Page<MajorView> {
        val college=colleges.selectById(collegeId) ?: missing();if(!admin && college.status!="ACTIVE") missing()
        val result=majors.selectPage(com.baomidou.mybatisplus.extension.plugins.pagination.Page(p.page.toLong(),p.pageSize.toLong()),QueryWrapper<Major>().eq("college_id",collegeId).eq(!admin,"status","ACTIVE").orderByAsc("name").orderByAsc("id"))
        return Page(result.records.map(::majorView),result.total,p.page,p.pageSize)
    }
    fun subjects(p: PageSpec,keyword: String?,publicOnly: Boolean): Page<SubjectView> = Page(sql.subjects(keyword,publicOnly,p.offset,p.pageSize).map(::subjectView),sql.subjectCount(keyword,publicOnly),p.page,p.pageSize)
    fun subject(id: UUID,publicOnly: Boolean): SubjectView=subjectView((if(publicOnly) sql.publishedSubject(id) else subjects.selectById(id)) ?: missing())
    fun college(id: UUID?,input: CollegeInput): MutationResult {
        val row=id?.let { sql.lockCollege(it) ?: missing() } ?: College().apply { this.id=UUID.randomUUID() }
        if(id!=null) requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version)
        row.name=name(input.name,80);row.code=name(input.code,40);row.status=activeStatus(input.status);row.updatedAt=Instant.now()
        if(id==null) colleges.insert(row) else { row.version++;colleges.updateById(row) }
        return MutationResult(row.id!!,row.version)
    }
    fun major(id: UUID?,input: MajorInput): MutationResult {
        if(colleges.selectById(input.collegeId)?.status!="ACTIVE") invalid("/collegeId")
        val row=id?.let { sql.lockMajor(it) ?: missing() } ?: Major().apply { this.id=UUID.randomUUID();collegeId=input.collegeId }
        if(id!=null) { requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version);if(row.collegeId!=input.collegeId) invalid("/collegeId","IMMUTABLE_PARENT","专业所属学院不可变更") }
        row.name=name(input.name,80);row.code=name(input.code,40);row.status=activeStatus(input.status);row.updatedAt=Instant.now()
        if(id==null) majors.insert(row) else { row.version++;majors.updateById(row) }
        return MutationResult(row.id!!,row.version)
    }
    fun subject(id: UUID?,input: SubjectInput): MutationResult {
        val row=id?.let { sql.lockSubject(it) ?: missing() } ?: Subject().apply { this.id=UUID.randomUUID() }
        if(id!=null) requireVersion(input.expectedVersion ?: invalid("/expectedVersion"),row.version)
        row.name=name(input.name);row.description=text(input.description,2000);row.status=activeStatus(input.status);row.updatedAt=Instant.now()
        if(id==null) subjects.insert(row) else { row.version++;subjects.updateById(row) }
        return MutationResult(row.id!!,row.version)
    }
}
