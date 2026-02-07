# Parcel-Safe: Mobile Application

The **Mobile Application** serves as the primary interface for Riders, Customers, and Admins in the Parcel-Safe ecosystem. It handles job management, OTP generation, and real-time monitoring of the Smart Top Box.

## � **NEW: Background Services & Real-time Notifications**

This app now features **industry-standard background services** similar to Uber, Grab, and Lalamove to ensure:
- ✅ Orders received even when app is **completely closed**
- ✅ Push notifications with **sound & vibration**
- ✅ **Foreground service** keeps Android app alive
- ✅ **Background fetch** for iOS periodic updates
- ✅ **Firebase Cloud Messaging** for reliable delivery
- ✅ **Real-time order listener** via Firebase Realtime Database

**📖 [Read the Background Service Guide](./BACKGROUND_SERVICE_GUIDE.md) for setup instructions**

## 🔗 Project Ecosystem
This component is part of the Parcel-Safe Monorepo.
*   **[Web Portal](../web/README.md)**: Public tracking dashboard for recipients.
*   **[Hardware](../hardware/README.md)**: ESP32 firmware controlling the physical box.

## 📱 Features
*   **Rider Interface**: Job acceptance, navigation, and box control (unlock/lock).
*   **Customer Interface**: Live tracking, OTP visibility, and delivery history.
*   **Admin Dashboard**: Audit logs for tamper events and delivery completion.
*   **Hybrid Architecture**: Uses **Supabase** for persistent data and **Firebase** for real-time state.
*   **🆕 Background Services**: FCM push notifications, foreground service, background fetch
*   **🆕 Order Listener**: Real-time order reception even when app is killed

## 🛠️ Tech Stack
*   **Framework**: [React Native](https://reactnative.dev/) (via [Expo](https://expo.dev/))
*   **UI Library**: React Native Paper, Gluestack UI
*   **Backend**: Supabase (Auth/DB), Firebase (Realtime Sync)
*   **Maps**: react-native-maps
*   **🆕 Notifications**: Firebase Cloud Messaging, Expo Notifications
*   **🆕 Background Services**: react-native-background-fetch, react-native-background-actions

## 🚀 Getting Started

### Prerequisites
*   Node.js & npm/yarn
*   **For background services**: Development build (NOT Expo Go)
*   Firebase project with FCM enabled
*   `google-services.json` in mobile directory

### Installation
```bash
# Install dependencies
npm install

# Verify background service setup (optional)
./setup-background-services.ps1  # Windows
# or
./setup-background-services.sh   # Linux/Mac
```

### Running the App

**Quick Start (Recommended):**
```powershell
# Windows - Ultimate Mode (auto-everything!)
.\start.ps1 -Ultimate
```

This launches the **Ultimate Dev Environment** which automatically:
- ✅ Analyzes & syncs all file changes
- ✅ Detects & clears stale caches (only when needed)
- ✅ Auto-installs dependencies if package.json changed
- ✅ Shows desktop notifications for important events
- ✅ Saves Metro logs with timestamps
- ✅ Monitors for errors with auto-analysis
- ✅ Performs thorough directory comparisons

**Other Start Script Options:**
```powershell
.\start.ps1                  # Normal mode
.\start.ps1 -ClearCache      # Force clear caches first
.\start.ps1 -Tunnel          # Use tunnel instead of LAN
.\start.ps1 -Verbose         # Show detailed logs
.\start.ps1 -SyncOnly        # Just sync files, don't start Metro
```

**Manual Start (For Development with Expo Go):**
```bash
npx expo start
```
⚠️ **Note:** Background services will NOT work in Expo Go

**For Production (Development Build):**
```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```
✅ Background services fully functional

## 🔔 Background Service Setup

### Quick Setup
1. Ensure `google-services.json` is in the `mobile/` directory
2. Run development build (not Expo Go)
3. Grant all permissions when prompted
4. Configure battery optimization (Android)
5. Enable Background App Refresh (iOS)

### Testing Background Services
```bash
# 1. Build and install the app
npx expo run:android  # or run:ios

# 2. Kill the app completely
# 3. Send test FCM from Firebase Console
# 4. Notification should appear even when app is killed
```

### User Configuration

**Android Users:**
- Disable battery optimization: Settings > Apps > Parcel Safe > Battery > Unrestricted
- Enable auto-start (Xiaomi/Huawei/OPPO)
- Lock app in recent apps

**iOS Users:**
- Enable Background App Refresh: Settings > General > Background App Refresh
- Allow notifications: Settings > Notifications > Parcel Safe
- Set location to "Always" during active deliveries

**📖 Full guide:** [BACKGROUND_SERVICE_GUIDE.md](./BACKGROUND_SERVICE_GUIDE.md)

## 📄 Documentation
*   **[Product Requirements](startup.md)**: User roles, screen flows, and features
*   **[Background Services Guide](BACKGROUND_SERVICE_GUIDE.md)**: Setup and troubleshooting
*   **[Software Design](docs/SOFTWARE_DESIGN_DIAGRAMS.md)**: Architecture diagrams

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch
```

## 🔧 Troubleshooting

### Notifications Not Working
1. Check if using development build (not Expo Go)
2. Verify FCM token in console logs
3. Check Firebase Console for delivery status
4. Review [Background Service Guide](./BACKGROUND_SERVICE_GUIDE.md) troubleshooting section

### App Gets Killed in Background
1. Disable battery optimization
2. Enable auto-start permission
3. Check manufacturer-specific settings
4. See https://dontkillmyapp.com/ for device-specific guides

### Orders Not Received
1. Verify internet connection
2. Check Firebase Realtime Database rules
3. Ensure FCM token is updated on server
4. Check notification permissions
