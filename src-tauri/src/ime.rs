//! Input-method detection for the composer's type-to-focus. [B]
//! A webview cannot see the active input source before the first keydown, so
//! the frontend asks here whether the current macOS input source is an IME
//! (anything that is not a plain keyboard layout: Pinyin, Kana, Hangul, …) and
//! caches it. `ime:changed` (bool) fires whenever the selected input source
//! changes. Other platforms report `false`.

use tauri::AppHandle;

/// True when the current input source is an input method rather than a
/// keyboard layout. Sync on purpose: Tauri runs sync commands on the main
/// thread, which TIS requires.
#[tauri::command]
pub fn ime_active() -> bool {
    imp::current_is_ime()
}

/// Emit `ime:changed` on every input-source switch (macOS; no-op elsewhere).
/// Must be called from the main thread (the app `setup` hook).
pub fn watch(app: &AppHandle) {
    imp::watch(app);
}

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::{CFEqual, CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::os::raw::c_void;
    use tauri::{AppHandle, Emitter};

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn TISCopyCurrentKeyboardInputSource() -> CFTypeRef;
        fn TISGetInputSourceProperty(source: CFTypeRef, key: CFStringRef) -> CFTypeRef;
        static kTISPropertyInputSourceType: CFStringRef;
        static kTISTypeKeyboardLayout: CFStringRef;
    }

    type CenterRef = *const c_void;
    type Callback =
        extern "C" fn(CenterRef, *mut c_void, CFStringRef, *const c_void, *const c_void);

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFNotificationCenterGetDistributedCenter() -> CenterRef;
        fn CFNotificationCenterAddObserver(
            center: CenterRef,
            observer: *const c_void,
            callback: Callback,
            name: CFStringRef,
            object: *const c_void,
            suspension_behavior: isize,
        );
    }

    /// CFNotificationSuspensionBehaviorDeliverImmediately.
    const DELIVER_IMMEDIATELY: isize = 4;

    pub fn current_is_ime() -> bool {
        // SAFETY: TIS calls follow the CF ownership rules (Copy → we release;
        // Get → borrowed from the source we still hold).
        unsafe {
            let source = TISCopyCurrentKeyboardInputSource();
            if source.is_null() {
                return false;
            }
            let ty = TISGetInputSourceProperty(source, kTISPropertyInputSourceType);
            let ime = !ty.is_null() && CFEqual(ty, kTISTypeKeyboardLayout as CFTypeRef) == 0;
            CFRelease(source);
            ime
        }
    }

    extern "C" fn on_changed(
        _center: CenterRef,
        observer: *mut c_void,
        _name: CFStringRef,
        _object: *const c_void,
        _info: *const c_void,
    ) {
        // SAFETY: `observer` is the leaked AppHandle boxed in `watch`.
        let app = unsafe { &*(observer as *const AppHandle) };
        let _ = app.emit("ime:changed", current_is_ime());
    }

    pub fn watch(app: &AppHandle) {
        let observer = Box::into_raw(Box::new(app.clone())) as *const c_void;
        let name = CFString::from_static_string(
            "com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged",
        );
        // SAFETY: the observer lives for the whole process (never freed), the
        // callback only reads it, and `name` is retained by the center.
        unsafe {
            CFNotificationCenterAddObserver(
                CFNotificationCenterGetDistributedCenter(),
                observer,
                on_changed,
                name.as_concrete_TypeRef(),
                std::ptr::null(),
                DELIVER_IMMEDIATELY,
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::AppHandle;

    pub fn current_is_ime() -> bool {
        false
    }

    pub fn watch(_app: &AppHandle) {}
}
