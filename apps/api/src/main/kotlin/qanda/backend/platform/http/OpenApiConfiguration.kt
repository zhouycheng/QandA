package qanda.backend.platform.http

import io.swagger.v3.core.converter.AnnotatedType
import io.swagger.v3.core.converter.ModelConverters
import io.swagger.v3.oas.models.*
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.media.*
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.security.*
import org.springdoc.core.customizers.OperationCustomizer
import org.springdoc.core.customizers.OpenApiCustomizer
import org.springframework.beans.factory.ObjectProvider
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import io.swagger.v3.oas.models.headers.Header
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import kotlin.reflect.full.primaryConstructor
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.web.bind.annotation.RequestMapping

@Configuration
class OpenApiConfiguration {
    @Bean fun openAPI(): OpenAPI {
        val errors=ModelConverters.getInstance().resolveAsResolvedSchema(AnnotatedType(ApiError::class.java))
        return OpenAPI().info(Info().title("QandA 学生自主复习平台 API").version("1.0.0"))
            .components(Components().schemas(errors.referencedSchemas).addSecuritySchemes("BearerAuth",SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer")))
    }
    @Bean fun apiOperations()=OperationCustomizer { operation,handler ->
        val mapping=AnnotatedElementUtils.findMergedAnnotation(handler.method,RequestMapping::class.java)
        val method=mapping?.method?.firstOrNull()?.name ?: "GET"
        operation.operationId=handler.beanType.simpleName.removeSuffix("Controller")+"_"+handler.method.name+"_"+method
        operation.tags=listOf(if(handler.beanType.packageName.contains(".platform.")) "platform" else handler.beanType.packageName.substringAfterLast('.'))
        val localPath=mapping?.value?.firstOrNull() ?: ""
        val root=AnnotatedElementUtils.findMergedAnnotation(handler.beanType,RequestMapping::class.java)?.value?.firstOrNull() ?: ""
        val requestSchema=operation.requestBody?.content?.get("application/json")
        val requestClass=handler.method.parameters.firstOrNull { it.isAnnotationPresent(org.springframework.web.bind.annotation.RequestBody::class.java) }?.type
        if(requestSchema!=null && method in setOf("PUT","PATCH") && requestClass!=qanda.backend.discovery.CourseInput::class.java && requestClass?.kotlin?.primaryConstructor?.parameters?.any { it.name=="expectedVersion" }==true) {
            requestSchema.schema=ComposedSchema().addAllOfItem(requestSchema.schema).addAllOfItem(ObjectSchema().addProperty("expectedVersion",IntegerSchema().format("int64").minimum(java.math.BigDecimal.ONE)).required(listOf("expectedVersion")))
        }
        if(requestSchema!=null && method=="POST" && root+localPath=="/api/v1/admin/administrators") {
            requestSchema.schema=ComposedSchema().addAllOfItem(requestSchema.schema).addAllOfItem(ObjectSchema().addProperty("password",StringSchema().minLength(12).maxLength(128)).required(listOf("password")))
        }
        operation.security=if(PublicRoutes.permits(method,root+localPath)) emptyList() else listOf(SecurityRequirement().addList("BearerAuth"))
        for(status in listOf(400,401,403,404,405,406,409,413,415,422,429,500,503)) {
            operation.responses.addApiResponse(status.toString(),ApiResponse().description("结构化错误，参见code和fieldErrors").content(Content().addMediaType("application/json",MediaType().schema(Schema<Any>().`$ref`("#/components/schemas/ApiError")))))
        }
        operation.responses.forEach { (status,response) ->
            response.addHeaderObject("X-Request-Id",Header().required(true).schema(StringSchema().format("uuid")))
            response.addHeaderObject("Cache-Control",Header().required(true).schema(StringSchema()._enum(listOf("no-store"))))
            if(status=="429") response.addHeaderObject("Retry-After",Header().required(true).schema(IntegerSchema().minimum(java.math.BigDecimal.ONE)))
        }
        operation
    }
    @Bean fun kotlinDtoSchemas(handlers: ObjectProvider<RequestMappingHandlerMapping>)=OpenApiCustomizer { api ->
        val classes=linkedSetOf<Class<*>>()
        fun visit(type: Type) {
            if(type is ParameterizedType) { visit(type.rawType);type.actualTypeArguments.forEach { visit(it) } }
            if(type is Class<*> && type.packageName.startsWith("qanda.backend") && classes.add(type)) type.declaredFields.forEach { visit(it.genericType) }
        }
        handlers.getObject().handlerMethods.values.forEach { method -> method.method.genericParameterTypes.forEach { visit(it) };visit(method.method.genericReturnType) }
        visit(ApiError::class.java)
        classes.forEach { clazz ->
            val schema=api.components.schemas[clazz.simpleName] ?: return@forEach
            val parameters=clazz.kotlin.primaryConstructor?.parameters ?: return@forEach
            schema.required=schema.required?.filter { key -> parameters.none { it.name==key && it.isOptional } }
            schema.additionalProperties=false
            parameters.filter { it.type.isMarkedNullable }.forEach nullable@ { parameter ->
                val property=schema.properties?.get(parameter.name) ?: return@nullable
                if(property.`$ref`!=null) {
                    val reference=Schema<Any>().`$ref`(property.`$ref`);property.`$ref`=null
                    property.anyOf=listOf(reference,Schema<Any>().types(setOf("null")))
                } else property.types=(property.types ?: property.type?.let { setOf(it) } ?: emptySet())+"null"
            }
            for(key in listOf("expectedVersion","expectedContentVersion")) schema.properties?.get(key)?.minimum=java.math.BigDecimal.ONE
            if(clazz.simpleName=="QuestionInput") {
                schema.properties.getValue("stem").minLength=1
                schema.properties.getValue("stem").maxLength=10000
                schema.oneOf=listOf("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER").map { kind ->
                    val branch=ObjectSchema().addProperty("type",StringSchema()._enum(listOf(kind)))
                    when(kind) {
                        "SINGLE_CHOICE","MULTIPLE_CHOICE" -> {
                            branch.addProperty("options",ArraySchema().minItems(2).maxItems(26))
                            branch.addProperty("correctAnswer",ArraySchema().minItems(if(kind=="SINGLE_CHOICE") 1 else 2).maxItems(if(kind=="SINGLE_CHOICE") 1 else 26).uniqueItems(true))
                            branch.addProperty("correctValue",Schema<Any>().types(setOf("null")))
                            branch.addProperty("referenceAnswer",Schema<Any>().types(setOf("null")))
                            branch.required=listOf("options","correctAnswer")
                        }
                        "TRUE_FALSE" -> {
                            branch.addProperty("correctValue",BooleanSchema());branch.required=listOf("correctValue")
                            branch.addProperty("options",ArraySchema().maxItems(0));branch.addProperty("correctAnswer",ArraySchema().maxItems(0))
                            branch.addProperty("referenceAnswer",Schema<Any>().types(setOf("null")))
                        }
                        else -> {
                            branch.addProperty("referenceAnswer",StringSchema().minLength(1).maxLength(10000).pattern("\\S"));branch.required=listOf("referenceAnswer")
                            branch.addProperty("options",ArraySchema().maxItems(0));branch.addProperty("correctAnswer",ArraySchema().maxItems(0))
                            branch.addProperty("correctValue",Schema<Any>().types(setOf("null")))
                        }
                    }
                    branch
                }
            }
        }
    }
}

object PublicRoutes {
    fun permits(method: String,path: String): Boolean = method=="GET" && (path=="/api/v1/colleges" || path.matches(Regex("/api/v1/colleges/(?:[0-9a-fA-F-]+|\\{id})/majors")) || path=="/api/v1/health") ||
        method=="POST" && path in setOf("/api/v1/auth/email-challenges","/api/v1/auth/email-registrations","/api/v1/auth/wechat-registrations","/api/v1/auth/sessions","/api/v1/auth/wechat-sessions","/api/v1/auth/password-resets","/api/v1/admin/auth/sessions")
}
