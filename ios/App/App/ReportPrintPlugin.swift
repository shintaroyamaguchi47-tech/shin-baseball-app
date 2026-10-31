import UIKit
import WebKit
import Capacitor

// アプリ内(WKWebView)では window.open / window.print が使えないため、
// レポートの印刷・PDF保存をiOS標準の印刷画面で行う。
// 印刷画面の「共有」→「ファイルに保存」でPDFとして保存できる。
@objc(ReportPrintPlugin)
public class ReportPrintPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "ReportPrintPlugin"
    public let jsName = "ReportPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printWebView", returnType: CAPPluginReturnPromise)
    ]

    // 印刷が終わるまで保持する(解放されると読み込みが止まる)
    private var printWebView: WKWebView?
    private var pendingCall: CAPPluginCall?

    // レポートのHTMLを画面外のWebViewで組版してから印刷する
    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html") else {
            call.reject("html is required")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                call.reject("view is not ready")
                return
            }
            self.finishPending()
            // 画面外に置く。ビュー階層に入れないとJS(紙面の組版)が止まることがある
            let webView = WKWebView(frame: CGRect(x: -2000, y: 0, width: 1100, height: 1500))
            webView.alpha = 0
            webView.isUserInteractionEnabled = false
            webView.navigationDelegate = self
            host.addSubview(webView)
            self.printWebView = webView
            self.pendingCall = call
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    // 画面に表示中のアプリ自体を印刷する(分析ハブの印刷ボタン)
    @objc func printWebView(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("webView is not ready")
                return
            }
            self.present(webView.viewPrintFormatter(), call: call, removeAfter: nil)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === printWebView, let call = pendingCall else { return }
        pendingCall = nil
        // フォント読み込み後の組版(スコアブックの倍率計算など)を待つ
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            self.present(webView.viewPrintFormatter(), call: call, removeAfter: webView)
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failLoad(webView, error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failLoad(webView, error)
    }

    private func failLoad(_ webView: WKWebView, _ error: Error) {
        guard webView === printWebView else { return }
        pendingCall?.reject("レポートを読み込めませんでした: \(error.localizedDescription)")
        pendingCall = nil
        cleanUp(webView)
    }

    private func present(_ formatter: UIViewPrintFormatter, call: CAPPluginCall, removeAfter webView: WKWebView?) {
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = call.getString("name") ?? "レポート"
        info.orientation = call.getBool("landscape", false) ? .landscape : .portrait

        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printFormatter = formatter
        let completion: UIPrintInteractionController.CompletionHandler = { _, completed, error in
            if let webView = webView { self.cleanUp(webView) }
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["completed": completed])
            }
        }
        // iPadはポップオーバーで出すため、表示位置が要る
        if UIDevice.current.userInterfaceIdiom == .pad, let view = bridge?.viewController?.view {
            let rect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            controller.present(from: rect, in: view, animated: true, completionHandler: completion)
        } else {
            controller.present(animated: true, completionHandler: completion)
        }
    }

    private func finishPending() {
        pendingCall?.reject("別の印刷を開始したため中止しました")
        pendingCall = nil
        if let webView = printWebView { cleanUp(webView) }
    }

    private func cleanUp(_ webView: WKWebView) {
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
        if printWebView === webView { printWebView = nil }
    }
}
