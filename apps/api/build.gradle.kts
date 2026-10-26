plugins {
    kotlin("jvm") version "2.2.21"
    kotlin("plugin.spring") version "2.2.21"
    id("org.springframework.boot") version "3.5.16"
    id("io.spring.dependency-management") version "1.1.7"
}
version = "0.1.0"
repositories { mavenCentral() }
kotlin { jvmToolchain(21) }
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-mail")
    implementation("com.twelvemonkeys.imageio:imageio-webp:3.15.0")
    implementation("com.tencentcloudapi:tencentcloud-sdk-java-ses:3.2.6")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.testcontainers:junit-jupiter:1.21.3")
    testImplementation("org.testcontainers:postgresql:1.21.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.withType<Test> { useJUnitPlatform() }
tasks.test { useJUnitPlatform { excludeTags("postgres", "platform-acceptance") } }
tasks.register<Test>("postgresTest") {
    description = "Verifies platform infrastructure against the isolated qanda_backend database."
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform { includeTags("postgres") }
    shouldRunAfter(tasks.test)
}
tasks.register<Test>("platformAcceptanceTest") {
    description = "Isolated platform mail/bootstrap/files acceptance, separate from prior A evidence."
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform { includeTags("platform-acceptance") }
}
listOf("platformMailTest" to "platform-mail", "platformFileTest" to "platform-file", "platformBoundaryTest" to "platform-boundary", "platformRateLimitTest" to "platform-rate-limit", "platformResponseCacheTest" to "platform-response-cache").forEach { (taskName, testTag) ->
    tasks.register<Test>(taskName) {
        group = "verification"
        testClassesDirs = sourceSets.test.get().output.classesDirs
        classpath = sourceSets.test.get().runtimeClasspath
        useJUnitPlatform { includeTags(testTag) }
        if (taskName == "platformMailTest") dependsOn(tasks.bootJar)
    }
}
