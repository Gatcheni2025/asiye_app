package com.asiyeapp.asiye

import android.app.Activity
import android.content.Intent
import android.provider.ContactsContract
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val deepLinkChannelName = "com.asiyeapp.asiye/deeplink"
    private val contactsChannelName = "com.asiyeapp.asiye/contacts"
    private val contactPickRequestCode = 4107

    private var deepLinkChannel: MethodChannel? = null
    private var contactsChannel: MethodChannel? = null
    private var pendingDeepLink: String? = null
    private var pendingContactResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        pendingDeepLink = intent?.data?.toString()

        deepLinkChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            deepLinkChannelName
        )

        deepLinkChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "getInitialLink" -> {
                    result.success(pendingDeepLink)
                    pendingDeepLink = null
                }
                else -> result.notImplemented()
            }
        }

        contactsChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            contactsChannelName
        )

        contactsChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "pickContact" -> {
                    if (pendingContactResult != null) {
                        result.error(
                            "contact_picker_busy",
                            "The contact picker is already open.",
                            null
                        )
                        return@setMethodCallHandler
                    }

                    pendingContactResult = result

                    try {
                        val intent = Intent(
                            Intent.ACTION_PICK,
                            ContactsContract.CommonDataKinds.Phone.CONTENT_URI
                        )

                        startActivityForResult(
                            intent,
                            contactPickRequestCode
                        )
                    } catch (error: Exception) {
                        pendingContactResult = null
                        result.error(
                            "contact_picker_failed",
                            error.message ?: "Unable to open phone contacts.",
                            null
                        )
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    @Deprecated("Deprecated in Android, retained for broad device compatibility.")
    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        super.onActivityResult(
            requestCode,
            resultCode,
            data
        )

        if (requestCode != contactPickRequestCode) {
            return
        }

        val result = pendingContactResult
        pendingContactResult = null

        if (result == null) {
            return
        }

        if (
            resultCode != Activity.RESULT_OK ||
            data?.data == null
        ) {
            result.success(null)
            return
        }

        val uri = data.data!!

        try {
            contentResolver.query(
                uri,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                null,
                null,
                null
            )?.use { cursor ->
                if (!cursor.moveToFirst()) {
                    result.success(null)
                    return
                }

                val nameIndex = cursor.getColumnIndex(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
                )

                val phoneIndex = cursor.getColumnIndex(
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                )

                val name =
                    if (nameIndex >= 0)
                        cursor.getString(nameIndex) ?: ""
                    else
                        ""

                val phone =
                    if (phoneIndex >= 0)
                        cursor.getString(phoneIndex) ?: ""
                    else
                        ""

                result.success(
                    mapOf(
                        "name" to name,
                        "phone" to phone
                    )
                )
            } ?: result.success(null)
        } catch (error: Exception) {
            result.error(
                "contact_read_failed",
                error.message ?: "Unable to read the selected contact.",
                null
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)

        val link = intent.data?.toString() ?: return
        pendingDeepLink = link
        deepLinkChannel?.invokeMethod("onDeepLink", link)
    }
}
