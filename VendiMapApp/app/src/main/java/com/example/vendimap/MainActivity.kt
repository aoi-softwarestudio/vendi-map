package com.example.vendimap

import android.Manifest
import android.annotation.SuppressLint
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
        Log.d("VendiMap", "Permissions: fine=$fineGranted, coarse=$coarseGranted")
        loadProductionUrl()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enable Chrome inspect debugging for WebView
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Create a parent container that supports fitsSystemWindows properly
        val container = FrameLayout(this).apply {
            fitsSystemWindows = true
            // Match the background color to the app's dark theme to prevent flicker
            setBackgroundColor(android.graphics.Color.parseColor("#0A0A0F"))
        }

        // Programmatically create the WebView
        webView = WebView(this).apply {
            // Enable focus and touch input for form elements
            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()

            webViewClient = object : WebViewClient() {
                @SuppressLint("WebViewClientOnReceivedSslError")
                override fun onReceivedSslError(
                    view: WebView?,
                    handler: SslErrorHandler?,
                    error: SslError?
                ) {
                    Log.w("VendiMapWebView", "SSL Error: $error")
                    handler?.proceed() // SSL証明書エラーを無視
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    if (request?.isForMainFrame == true) {
                        val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error?.description else "Error"
                        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error?.errorCode else 0
                        Log.e("VendiMapWebView", "MainFrame Error: $desc ($code)")
                        Toast.makeText(applicationContext, "接続エラー: $desc ($code)", Toast.LENGTH_LONG).show()
                    }
                }

                override fun onReceivedError(
                    view: WebView?,
                    errorCode: Int,
                    description: String?,
                    failingUrl: String?
                ) {
                    super.onReceivedError(view, errorCode, description, failingUrl)
                    Log.e("VendiMapWebView", "Legacy MainFrame Error: $description ($errorCode)")
                    Toast.makeText(applicationContext, "接続エラー: $description ($errorCode)", Toast.LENGTH_LONG).show()
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(
                    origin: String?,
                    callback: GeolocationPermissions.Callback?
                ) {
                    // Automatically grant location request inside web page
                    callback?.invoke(origin, true, false)
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    val msg = consoleMessage?.message() ?: ""
                    val src = consoleMessage?.sourceId() ?: ""
                    val line = consoleMessage?.lineNumber() ?: 0
                    val level = consoleMessage?.messageLevel()
                    Log.d("VendiMapJS", "JS [$level]: $msg (Line: $line in $src)")
                    
                    if (level == ConsoleMessage.MessageLevel.ERROR) {
                        runOnUiThread {
                            Toast.makeText(applicationContext, "JS Error: $msg", Toast.LENGTH_LONG).show()
                        }
                    }
                    return true
                }
            }

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                setGeolocationEnabled(true)
                cacheMode = WebSettings.LOAD_DEFAULT
                
                // Crucial for responsive layout (meta viewport tag support)
                useWideViewPort = true
                loadWithOverviewMode = false // Disable overview mode to prevent forced desktop scale

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                }
            }
        }

        // Add WebView to the container with MATCH_PARENT layout parameters
        val matchParentParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        container.addView(webView, matchParentParams)

        // Set the container as the main content view of this Activity
        setContentView(container)

        // Request permissions and then load URL
        requestPermissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    private fun loadProductionUrl() {
        val timestamp = System.currentTimeMillis()
        webView.loadUrl("https://vendimap-app.onrender.com/index.html?t=$timestamp")
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
