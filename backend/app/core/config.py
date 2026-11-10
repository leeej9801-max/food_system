from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    guest_api_prefix: str = "/api/guest/v1"
    # 손님 익명 기기 쿠키. 기본은 Secure. 브라우저는 http://localhost도 허용한다
    guest_cookie_secure: bool = True
    # 천문연 특일정보(공공데이터포털) 인증키. 값은 .env에만 둔다 (U-28)
    kasi_service_key: str = ""
    # 기본값 없음: DATABASE_URL이 없으면 기동하지 않는다 (SEC-001)
    database_url: str
    app_timezone: str = "Asia/Seoul"
    cors_allowed_origins: str = "http://localhost:5173"
    pos_mode: str = "csv"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


settings = Settings()
