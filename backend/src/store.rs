use crate::database::Database;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use crate::proxy::providers::xai_oauth_auth::XaiOAuthManager;
use crate::services::proxy::ProxyService;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 全局应用状态；克隆只共享服务、数据库和账号管理器。
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub copilot_auth_state: Arc<RwLock<CopilotAuthManager>>,
    pub codex_oauth_state: Arc<RwLock<CodexOAuthManager>>,
    pub xai_oauth_state: Arc<RwLock<XaiOAuthManager>>,
    pub proxy_service: ProxyService,
    pub(crate) mode_startup_errors: Arc<RwLock<std::collections::HashMap<String, String>>>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        let copilot_auth_state = Arc::new(RwLock::new(CopilotAuthManager::new(
            crate::config::get_app_config_dir(),
        )));
        let codex_oauth_state = Arc::new(RwLock::new(CodexOAuthManager::new(
            crate::config::get_app_config_dir(),
        )));
        let xai_oauth_state = Arc::new(RwLock::new(XaiOAuthManager::new(
            crate::config::get_app_config_dir(),
        )));
        let proxy_service = ProxyService::new_with_auth(
            db.clone(),
            copilot_auth_state.clone(),
            codex_oauth_state.clone(),
            xai_oauth_state.clone(),
        );

        Self {
            db,
            copilot_auth_state,
            codex_oauth_state,
            xai_oauth_state,
            proxy_service,
            mode_startup_errors: Arc::new(RwLock::new(Default::default())),
        }
    }
}
