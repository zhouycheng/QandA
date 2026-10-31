FROM eclipse-temurin:21-jre-jammy

LABEL qanda.backend="true"
WORKDIR /app
RUN groupadd --gid 10001 qanda \
    && useradd --uid 10001 --gid qanda --no-create-home qanda \
    && mkdir -p /var/lib/qanda/assets \
    && chown qanda:qanda /var/lib/qanda/assets
COPY --chown=qanda:qanda target/qanda-backend-1.0.0.jar /app/app.jar
USER qanda:qanda
EXPOSE 8083
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 \
    CMD curl --fail --silent http://127.0.0.1:8083/api/v1/health || exit 1
ENTRYPOINT ["java", "-Xmx512m", "-Djava.awt.headless=true", "-jar", "/app/app.jar"]
