package com.linsora.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int REQUEST_RECORD_AUDIO = 1001;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    public void onStart() {
        super.onStart();
        setupWebChromeClientForMicrophone();
    }

    /**
     * Substitui o WebChromeClient do Capacitor para interceptar as solicitações
     * de permissão vindas do JavaScript (getUserMedia / SpeechRecognition) e
     * repassá-las ao sistema Android.
     */
    private void setupWebChromeClientForMicrophone() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean needsMic = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        needsMic = true;
                        break;
                    }
                }

                if (needsMic) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this,
                            Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        // Permissão já concedida — libera o WebView imediatamente
                        request.grant(request.getResources());
                    } else {
                        // Salva o pedido e solicita permissão nativa ao Android
                        pendingWebPermissionRequest = request;
                        ActivityCompat.requestPermissions(
                                MainActivity.this,
                                new String[]{Manifest.permission.RECORD_AUDIO},
                                REQUEST_RECORD_AUDIO
                        );
                    }
                } else {
                    // Outros recursos: delega ao comportamento padrão do Capacitor
                    request.grant(request.getResources());
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQUEST_RECORD_AUDIO && pendingWebPermissionRequest != null) {
            if (grantResults.length > 0 &&
                    grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
            } else {
                pendingWebPermissionRequest.deny();
            }
            pendingWebPermissionRequest = null;
        }
    }
}
