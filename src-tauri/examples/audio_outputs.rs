// Read-only endpoint diagnostic; does not open streams or change Windows routing.
use rodio::cpal::traits::{HostTrait, DeviceTrait};
fn main() {
    let host = rodio::cpal::default_host();
    let default = host.default_output_device().and_then(|device| device.name().ok());
    println!("System default: {default:?}");
    match host.output_devices() {
        Ok(devices) => for device in devices {
            println!("Output: {:?}",device.name());
        },
        Err(error) => eprintln!("Enumeration failed: {error}"),
    }
}
