import SwiftUI

@main
struct OMSFinanceApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Palette.accentDeep)
                .preferredColorScheme(.light) // premium white mode
        }
    }
}
