use crate::models::AudioDeviceInfo;

#[derive(Debug,PartialEq)]
pub enum RouteAction { Keep, FollowDefault, Unavailable }
pub fn route_action(selected: &str, active: Option<&str>, devices: &[AudioDeviceInfo]) -> RouteAction {
    let Some(active) = active else { return RouteAction::Keep; };
    if !selected.trim().is_empty() {
        return if devices.iter().any(|device| device.name == selected) { RouteAction::Keep } else { RouteAction::Unavailable };
    }
    match devices.iter().find(|device| device.is_default) {
        Some(device) if device.name != active => RouteAction::FollowDefault,
        Some(_) => RouteAction::Keep,
        None => RouteAction::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn outputs() -> Vec<AudioDeviceInfo> { vec![AudioDeviceInfo { name:"Speakers".into(),is_default:false },AudioDeviceInfo { name:"Headphones".into(),is_default:true }] }
    #[test]
    fn default_route_follows_new_windows_default() {
        assert_eq!(route_action("",Some("Speakers"),&outputs()),RouteAction::FollowDefault);
        assert_eq!(route_action("",Some("Headphones"),&outputs()),RouteAction::Keep);
    }
    #[test]
    fn explicit_output_is_isolated_from_windows_default_changes() {
        assert_eq!(route_action("Speakers",Some("Speakers"),&outputs()),RouteAction::Keep);
    }
    #[test]
    fn removed_explicit_output_never_falls_back_to_speakers() {
        assert_eq!(route_action("USB Headset",Some("USB Headset"),&outputs()),RouteAction::Unavailable);
        assert_eq!(route_action("",Some("Headphones"),&[]),RouteAction::Unavailable);
    }
    #[test]
    fn reconnect_or_initial_detection_does_not_start_playback() {
        assert_eq!(route_action("",None,&outputs()),RouteAction::Keep);
        assert_eq!(route_action("Headphones",None,&outputs()),RouteAction::Keep);
    }
}
