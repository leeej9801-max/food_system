from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    guest_api_prefix: str = "/api/guest/v1"
    # 손님 익명 기기 쿠키. 기본은 Secure. 브라우저는 http://localhost도 허용한다
    guest_cookie_secure: bool = True
    # 천문연 특일정보(공공데이터포털) 인증키. 값은 .env에만 둔다 (U-28)
    kasi_service_key: str = ""
    # 기상청 API허브 인증키와 AWS 지점번호(부천 433). 값은 .env에만 둔다 (U-28, U-56)
    kma_apihub_key: str = ""
    kma_station_id: str = ""
    # 단기예보 격자(부천 상동 56,125). 0이면 예보를 부르지 않는다 (U-57)
    kma_grid_nx: int = 0
    kma_grid_ny: int = 0
    # 기본값 없음: DATABASE_URL이 없으면 기동하지 않는다 (SEC-001)
    database_url: str
    app_timezone: str = "Asia/Seoul"
    cors_allowed_origins: str = "http://localhost:5173"
    pos_mode: str = "csv"
    kakao_rest_api_key: str = ""
    kakao_client_secret: str = ""
    kakao_redirect_uri: str = "http://localhost:8001/api/v1/auth/kakao/callback"
    staff_frontend_url: str = "http://localhost:5175"
    # 미설정 시 카카오 client secret에서 용도를 분리한 HMAC 키를 유도한다.
    staff_auth_signing_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


settings = Settings()  # pyright: ignore[reportCallIssue]  # 값은 환경변수에서 온다
