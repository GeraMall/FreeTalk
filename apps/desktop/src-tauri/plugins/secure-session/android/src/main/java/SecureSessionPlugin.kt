package io.freetalk.securesession

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SetRequest {
    lateinit var refreshToken: String
}

@TauriPlugin
class SecureSessionPlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "io.freetalk.android.refresh-token"
    private val preferences by lazy {
        activity.getSharedPreferences("freetalk_secure_session", Activity.MODE_PRIVATE)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    @Command
    fun set(invoke: Invoke) {
        try {
            val request = invoke.parseArgs(SetRequest::class.java)
            if (request.refreshToken.length !in 32..256) {
                invoke.reject("invalid refresh token")
                return
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val encrypted = cipher.doFinal(request.refreshToken.toByteArray(Charsets.UTF_8))
            val payload = ByteBuffer.allocate(4 + cipher.iv.size + encrypted.size)
                .putInt(cipher.iv.size)
                .put(cipher.iv)
                .put(encrypted)
                .array()
            preferences.edit()
                .putString("refresh_token", Base64.encodeToString(payload, Base64.NO_WRAP))
                .commit()
            invoke.resolve()
        } catch (error: Exception) {
            invoke.reject("secure session write failed", error)
        }
    }

    @Command
    fun get(invoke: Invoke) {
        try {
            val encoded = preferences.getString("refresh_token", null)
            val response = JSObject()
            if (encoded == null) {
                response.put("value", null)
                invoke.resolve(response)
                return
            }
            val buffer = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP))
            val ivLength = buffer.int
            if (ivLength !in 12..32 || buffer.remaining() <= ivLength) {
                throw IllegalStateException("invalid encrypted session")
            }
            val iv = ByteArray(ivLength).also(buffer::get)
            val encrypted = ByteArray(buffer.remaining()).also(buffer::get)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            response.put("value", String(cipher.doFinal(encrypted), Charsets.UTF_8))
            invoke.resolve(response)
        } catch (error: Exception) {
            preferences.edit().remove("refresh_token").apply()
            invoke.reject("secure session read failed", error)
        }
    }

    @Command
    fun clear(invoke: Invoke) {
        preferences.edit().remove("refresh_token").commit()
        invoke.resolve()
    }
}
