"""설정 로드 안전성 검증."""
import importlib


def test_config_import_does_not_emit_secret(capfd):
    # 6) 설정 import(재로드) 시 시크릿이 표준출력/에러로 새어나오지 않는다.
    import app.core.config as config_module

    importlib.reload(config_module)
    out, err = capfd.readouterr()

    secret = config_module.settings.SESSION_SIGNING_SECRET
    assert secret, "테스트 시크릿이 로드돼야 한다"
    assert secret not in out
    assert secret not in err


def test_database_url_absent_and_engine_is_lazy():
    # 7) DATABASE_URL이 없어도 config/db import 가능 + import 시 엔진 미생성(무접속).
    import app.core.config as config_module
    import app.database.session as session_module

    assert config_module.settings.DATABASE_URL == ""
    assert session_module._engine is None
