# Parcel-Safe: Mobile Application

The **Mobile Application** serves as the primary interface for Riders, Customers, and Admins in the Parcel-Safe ecosystem. It handles job management, OTP generation, and real-time monitoring of the Smart Top Box.

## 🔗 Project Ecosystem
This component is part of the Parcel-Safe Monorepo.
*   **[Web Portal](../web/README.md)**: Public tracking dashboard for recipients.
*   **[Hardware](../hardware/README.md)**: ESP32 firmware controlling the physical box.

## 📱 Features
*   **Rider Interface**: Job acceptance, navigation, and box control (unlock/lock).
*   **Customer Interface**: Live tracking, OTP visibility, and delivery history.
*   **Admin Dashboard**: Audit logs for tamper events and delivery completion.
*   **Hybrid Architecture**: Uses **Supabase** for persistent data and **Firebase** for real-time state.

## 🛠️ Tech Stack
*   **Framework**: [React Native](https://reactnative.dev/) (via [Expo](https://expo.dev/))
*   **UI Library**: React Native Paper, Gluestack UI
*   **Backend**: Supabase (Auth/DB), Firebase (Realtime Sync)
*   **Maps**: react-native-maps

## 🚀 Getting Started

### Prerequisites
*   Node.js & npm/yarn
*   Expo Go app on your physical device or an Android/iOS Emulator.

### Installation
```bash
# Install dependencies
npm install
```

### Running the App
```bash
# Start the development server
npx expo start
```
Scan the QR code with Expo Go (Android) or the Camera app (iOS).

## 📄 Documentation
For a detailed breakdown of user roles, screen flows, and future enhancements, see the [Product Requirements Document](startup.md).
