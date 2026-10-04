use super::ProviderService;
use crate::{app_config::AppType, error::AppError, provider::Provider, store::AppState};

impl ProviderService {
    pub(crate) fn save_desktop(
        state: &AppState,
        provider: Provider,
        add: bool,
    ) -> Result<bool, AppError> {
        let _service = futures::executor::block_on(crate::mode::controller::lock_service());
        let _app =
            futures::executor::block_on(state.proxy_service.lock_switch_for_app("claude-desktop"));
        crate::mode::operation::settle(&state.db, "claude-desktop")?;
        Self::validate_provider_settings(&AppType::ClaudeDesktop, &provider)?;
        let previous = state
            .db
            .get_provider_by_id(&provider.id, "claude-desktop")?;
        if !add && previous.is_none() {
            return Err(AppError::Message(format!("供应商 {} 不存在", provider.id)));
        }
        let current = crate::mode::current::provider_for(
            &state.db,
            &AppType::ClaudeDesktop,
            crate::mode::current::Purpose::Direct,
        )?;
        let was_mapping = crate::mode::controller::desktop_uses_mapping(state)?;
        state.db.save_provider("claude-desktop", &provider)?;
        if current.is_none() && add || current.as_deref() == Some(&provider.id) {
            if let Err(error) = futures::executor::block_on(
                crate::mode::controller::apply_desktop_locked(state, &provider, was_mapping),
            ) {
                if !crate::mode::operation::has_pending("claude-desktop") {
                    match previous {
                        Some(row) => state.db.save_provider("claude-desktop", &row)?,
                        None => state.db.delete_provider("claude-desktop", &provider.id)?,
                    }
                }
                return Err(error);
            }
        }
        Ok(true)
    }
}
