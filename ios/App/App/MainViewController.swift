import UIKit
import Capacitor

// アプリ内に置いた独自プラグインはnpmパッケージと違い自動登録されないので、ここで登録する。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ReportPrintPlugin())
    }
}
