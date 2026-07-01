import SwiftUI

struct ContentView: View {
    // Replace with your actual live production URL hosted on Netlify
    let productionURL = URL(string: "https://vendimap-app.onrender.com/index.html")!

    var body: some View {
        ZStack {
            // Dark elegant background matching VendiMap identity
            Color(red: 8/255, green: 13/255, blue: 26/255)
                .ignoresSafeArea()
            
            WebView(url: productionURL)
                .ignoresSafeArea(edges: .bottom) // Keep status bar area clean, overlap bottom safe area
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
