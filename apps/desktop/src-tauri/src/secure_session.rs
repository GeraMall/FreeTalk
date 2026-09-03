#[cfg(not(target_os = "android"))]
const SERVICE: &str = "io.freetalk.desktop.refresh-token";

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn secure_session_set(refresh_token: String) -> Result<(), String> {
    if refresh_token.len() < 32 || refresh_token.len() > 256 {
        return Err("invalid refresh token".into());
    }
    platform::set(refresh_token.as_bytes())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn secure_session_get() -> Result<Option<String>, String> {
    platform::get()?
        .map(String::from_utf8)
        .transpose()
        .map_err(|_| "invalid stored token".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn secure_session_clear() -> Result<(), String> {
    platform::delete()
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn secure_session_set(app: tauri::AppHandle, refresh_token: String) -> Result<(), String> {
    use tauri::Manager;
    if refresh_token.len() < 32 || refresh_token.len() > 256 {
        return Err("invalid refresh token".into());
    }
    app.state::<freetalk_secure_session::SecureSession<tauri::Wry>>()
        .set(&refresh_token)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn secure_session_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri::Manager;
    app.state::<freetalk_secure_session::SecureSession<tauri::Wry>>()
        .get()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn secure_session_clear(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    app.state::<freetalk_secure_session::SecureSession<tauri::Wry>>()
        .clear()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::SERVICE;
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr, slice};

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1168;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        credential_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(
            target: *const u16,
            credential_type: u32,
            flags: u32,
            credential: *mut *mut CredentialW,
        ) -> i32;
        fn CredDeleteW(target: *const u16, credential_type: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn target() -> Vec<u16> {
        std::ffi::OsStr::new(SERVICE)
            .encode_wide()
            .chain(Some(0))
            .collect()
    }

    pub fn set(secret: &[u8]) -> Result<(), String> {
        let mut target = target();
        let mut user: Vec<u16> = std::ffi::OsStr::new("FreeTalk")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let credential = CredentialW {
            flags: 0,
            credential_type: CRED_TYPE_GENERIC,
            target_name: target.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            credential_blob_size: secret.len() as u32,
            credential_blob: secret.as_ptr() as *mut u8,
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: user.as_mut_ptr(),
        };
        let written = unsafe { CredWriteW(&credential, 0) };
        if written == 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }

    pub fn get() -> Result<Option<Vec<u8>>, String> {
        let target = target();
        let mut credential = ptr::null_mut();
        let read = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if read == 0 {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
                Ok(None)
            } else {
                Err(error.to_string())
            };
        }
        if credential.is_null() {
            return Ok(None);
        }
        let value = unsafe {
            let item = &*credential;
            slice::from_raw_parts(item.credential_blob, item.credential_blob_size as usize).to_vec()
        };
        unsafe { CredFree(credential.cast()) };
        Ok(Some(value))
    }

    pub fn delete() -> Result<(), String> {
        let target = target();
        let deleted = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if deleted != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
            Ok(())
        } else {
            Err(error.to_string())
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::SERVICE;
    use std::{ffi::c_void, ptr, slice};

    type ItemRef = *mut c_void;
    const ACCOUNT: &[u8] = b"refresh-token";
    const ERR_ITEM_NOT_FOUND: i32 = -25300;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainFindGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const u8,
            account_len: u32,
            account: *const u8,
            password_len: *mut u32,
            password_data: *mut *mut c_void,
            item: *mut ItemRef,
        ) -> i32;
        fn SecKeychainAddGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const u8,
            account_len: u32,
            account: *const u8,
            password_len: u32,
            password_data: *const c_void,
            item: *mut ItemRef,
        ) -> i32;
        fn SecKeychainItemModifyAttributesAndData(
            item: ItemRef,
            attributes: *const c_void,
            length: u32,
            data: *const c_void,
        ) -> i32;
        fn SecKeychainItemFreeContent(attributes: *const c_void, data: *mut c_void) -> i32;
        fn SecKeychainItemDelete(item: ItemRef) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
    }

    fn find(password_len: &mut u32, password_data: &mut *mut c_void, item: &mut ItemRef) -> i32 {
        unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr(),
                password_len,
                password_data,
                item,
            )
        }
    }

    pub fn set(secret: &[u8]) -> Result<(), String> {
        let mut length = 0;
        let mut data = ptr::null_mut();
        let mut item = ptr::null_mut();
        let status = find(&mut length, &mut data, &mut item);
        if status == 0 {
            unsafe {
                SecKeychainItemFreeContent(ptr::null(), data);
            }
            let modified = unsafe {
                SecKeychainItemModifyAttributesAndData(
                    item,
                    ptr::null(),
                    secret.len() as u32,
                    secret.as_ptr().cast(),
                )
            };
            unsafe { CFRelease(item) };
            return if modified == 0 {
                Ok(())
            } else {
                Err(format!("Keychain error {modified}"))
            };
        }
        if status != ERR_ITEM_NOT_FOUND {
            return Err(format!("Keychain error {status}"));
        }
        let added = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr(),
                secret.len() as u32,
                secret.as_ptr().cast(),
                ptr::null_mut(),
            )
        };
        if added == 0 {
            Ok(())
        } else {
            Err(format!("Keychain error {added}"))
        }
    }

    pub fn get() -> Result<Option<Vec<u8>>, String> {
        let mut length = 0;
        let mut data = ptr::null_mut();
        let mut item = ptr::null_mut();
        let status = find(&mut length, &mut data, &mut item);
        if status == ERR_ITEM_NOT_FOUND {
            return Ok(None);
        }
        if status != 0 {
            return Err(format!("Keychain error {status}"));
        }
        let value = unsafe { slice::from_raw_parts(data.cast::<u8>(), length as usize).to_vec() };
        unsafe {
            SecKeychainItemFreeContent(ptr::null(), data);
            CFRelease(item);
        }
        Ok(Some(value))
    }

    pub fn delete() -> Result<(), String> {
        let mut length = 0;
        let mut data = ptr::null_mut();
        let mut item = ptr::null_mut();
        let status = find(&mut length, &mut data, &mut item);
        if status == ERR_ITEM_NOT_FOUND {
            return Ok(());
        }
        if status != 0 {
            return Err(format!("Keychain error {status}"));
        }
        unsafe {
            SecKeychainItemFreeContent(ptr::null(), data);
        }
        let deleted = unsafe { SecKeychainItemDelete(item) };
        unsafe { CFRelease(item) };
        if deleted == 0 {
            Ok(())
        } else {
            Err(format!("Keychain error {deleted}"))
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "android")))]
mod platform {
    pub fn set(_: &[u8]) -> Result<(), String> {
        Err("secure storage is unsupported".into())
    }
    pub fn get() -> Result<Option<Vec<u8>>, String> {
        Err("secure storage is unsupported".into())
    }
    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}
