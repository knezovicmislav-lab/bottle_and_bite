# Bottle & Bite – Android test app

This folder turns the live web app (https://bottle-and-bite.vercel.app) into an installable Android app using Capacitor.
GitHub builds it for you: see `.github/workflows/android.yml` at the root of the repository.

- The app opens the live website inside a native Android shell, so any change you push to the web app shows up in the Android app immediately, without rebuilding.
- Camera access is enabled so "Take a photo" and the selfie button open the phone camera.
- The file GitHub produces is a *debug* test build for installing directly on your own phone. For the Google Play Store you'll later need a signed *release* build (AAB).

To change the app icon or splash screen, replace the images in `assets/` (same sizes) and upload them; GitHub rebuilds automatically.
