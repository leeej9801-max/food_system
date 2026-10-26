from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    # PROVISIONAL (P-07): 기본값은 로컬 개발 편의를 위해 SQLite 파일을 허용하되,
    # 파일럿/정식 개발 환경에서는 PostgreSQL DATABASE_URL을 .env로 주입한다.
    database_url: str = "sqlite:///./local_dev.db"
    app_timezone: str = "Asia/Seoul"
    cors_allowed_origins: str = "http://localhost:5173"
    pos_mode: str = "csv"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


settings = Settings()
