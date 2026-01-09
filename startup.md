Below is the updated, **full PRD for your React Native + Expo mobile app**, now incorporating **React Native Paper, Gluestack UI, and React Native Elements**, plus optional libraries that perfectly fit your use case (sensor UI, map UI, OTP UI, camera view, etc.).

Everything is structured cleanly for thesis documentation + actual development.

---

# **PRODUCT REQUIREMENTS DOCUMENT (PRD)**

### **Parcel-Safe Mobile App (React Native + Expo)**

### **Platforms:** Android (Primary), iOS (Optional — if Expo supports required modules)

### **Tech Stack:**

* **React Native (Expo)**
* **State:** Zustand or Redux Toolkit
* **Navigation:** React Navigation
* **UI Libraries:**

  * **React Native Paper** (Material Design components)
  * **Gluestack UI** (Enterprise UI primitives, theming, accessibility)
  * **React Native Elements** (Cross-platform component kit)
  * **Optional Add-ons:**

    * **react-native-maps** (Live tracking UI)
    * **expo-camera** / **expo-image-picker** (Preview captured tamper images)
    * **react-native-otp-entry** or **react-native-confirmation-code-field** (OTP UI)
    * **lottie-react-native** (Micro-animations)
    * **reanimated + gesture handler** (Smooth transitions)

---

# **1. App Purpose**

Provide a mobile interface for:

* Riders (Courier App)
* Customers (Receiver App)
* Admin (Audit App)

All interacting with the **Parcel-Safe Hardware Box** (GPS module + OTP verification + tamper sensors + camera upload).

The mobile app is the trusted interface that:

1. Generates and displays OTPs
2. Shows real-time GPS location of the box
3. Displays tamper alerts
4. Shows delivery audit logs + images
5. Provides the rider with transaction management tools

---

# **2. User Roles**

### **2.1 Customer (Receiver)**

* Input delivery details
* Receive OTP
* Monitor box location in real-time
* Confirm delivery
* View transaction log

### **2.2 Rider (Courier)**

* Accept delivery tasks
* View assigned parcels
* Monitor box lock status
* Verify GPS fencing on arrival
* Trigger delivery completion

### **2.3 Admin**

* View all transactions
* View tamper alerts
* View photo audit logs
* Export logs

---

# **3. Core Features (Mobile App)**

### **3.1 OTP Management**

* Generate time-based OTP (TOTP)
* Countdown timer display
* Regeneration logic
* OTP expiration handling
* Visual feedback (React Native Paper / Elements):

  * Status chip: *Valid / Expired / Used*

---

### **3.2 Real-Time GPS Tracking (Customer + Admin)**

Map page shows:

* Box location (GPS from hardware)
* Rider location (phone GPS)
* Destination pin
* Geo-fence radius (50 m circle)
* Route line (optional)
* Tamper icon overlay if alert is active

---

### **3.3 Delivery Transaction Flow**

* Rider receives job
* Rider picks up parcel
* Box logs transitions:

  * *Locked → In transit → At destination → Unlocked*
* Customer enters OTP
* Box unlocks + camera captures audit photo
* Delivery completion logged in cloud

---

### **3.4 Tamper Alert & Photo Logs (Admin & Customer)**

If sensors detect tampering:

* Push notification sent to customer + admin
* Camera auto-captures images
* Logs include timestamp + GPS + photos
* Screen for image carousel + metadata

---

### **3.5 Rider Management Pages**

* Assigned deliveries
* Current delivery status
* Box connection status (Bluetooth/LoRa/WiFi)
* Battery status (from hardware)
* OTP unlock attempt logs

---

# **4. App Architecture (Screen-by-Screen)**

---

# **A. Customer App Screens**

### **A1. Login / Register**

**UI Libraries Used:** React Native Elements + Gluestack UI
Elements: Input, Button

* Email / phone login
* OTP verification for account (not box OTP)

---

### **A2. Home Dashboard**

**UI:** React Native Paper (Cards + FAB)
Modules visible:

* Active Deliveries
* Track Order
* OTP Panel
* Notifications

---

### **A3. OTP Screen**

**UI:** react-native-confirmation-code-field

* Shows 6-digit OTP
* Automatic expiration countdown
* Copy-to-clipboard button
* Status indicator chip (Paper)

---

### **A4. Live Tracking Map**

**UI:** react-native-maps + Gluestack UI overlays
Map shows:

* Box location
* Rider location
* Geo-fence circle
* Address panel
* Alert badge if tampering occurred

---

### **A5. Delivery Log**

**UI:** React Native Paper DataTable
Entries:

* Time opened
* GPS
* OTP validity
* Rider ID
* Photo audit button

---

### **A6. Photo Audit Viewer**

**UI:** Gluestack UI + Image Carousel
Shows:

* Tamper attempt photos
* Successful claim photos
* Time + GPS metadata

---

---

# **B. Rider App Screens**

### **B1. Login**

Same implementation as Customer.

---

### **B2. Rider Dashboard**

**UI:** Gluestack UI Cards
Shows:

* *Next Delivery*
* *Box Status (Locked/Unlocked)*
* *In-Transit Alerts*
* *Battery Status of Box*

---

### **B3. Assigned Deliveries**

**UI:** RN Paper List Items
Each job card shows:

* Tracking ID
* Destination
* Status
* Start Trip button

---

### **B4. Box Controls / Status**

**UI:** Elements + Lottie animations
Shows:

* Lock status
* GPS signal
* Connection strength
* Real-time logs

---

### **B5. Arrival Screen (Geo-Fence Detection)**

UI Behavior:

* If inside 50 m: Green unlocked animation, enable OTP panel
* If outside: Red border + disable OTP

---

### **B6. Delivery Completion Screen**

* Auto-upload final logs
* Rider confirms successful handover

---

---

# **C. Admin App Screens**

### **C1. Dashboard**

**UI:** Paper + Lottie
Cards show:

* Total deliveries
* Tamper events
* Open cases
* Active riders

---

### **C2. Global Map**

Shows:

* All active boxes
* Historical playback mode
* Heatmap for tamper hotspots (optional)

---

### **C3. Tamper Alerts Center**

List View:

* Tamper time
* Box ID
* Location
* Photo logs

---

### **C4. Delivery Records**

Filterable by date, rider, status
**UI:** Paper DataTable

---

### **C5. Photo Audit Archive**

Carousel + metadata viewer

---

---

# **5. API Requirements (Backend & Firmware Integration)**

### **5.1 Hardware → Cloud**

* GPS coordinates
* Tamper sensor state
* Power cut events
* Photo uploads (base64 or URL)
* Unlock attempts
* Successful unlocks

---

### **5.2 App → Cloud**

* OTP generation
* OTP verification request
* Delivery assignment
* Delivery completion

---

### **5.3 App ↔ Hardware**

(Depends on connection mode)

* BLE (Preferred for prototype)
* WiFi hotspot from hardware
* LoRa / GSM for long-range (future upgrade)

---

---

# **6. Component Library Usage Per Screen**

| Screen         | Paper | Gluestack | RN Elements | Others            |
| -------------- | ----- | --------- | ----------- | ----------------- |
| Login          | ✓     | ✓         | ✓           | —                 |
| Dashboard      | ✓     | ✓         | —           | Lottie            |
| OTP Entry      | —     | ✓         | ✓           | OTP Field         |
| Map            | —     | ✓         | —           | react-native-maps |
| Audit Logs     | ✓     | —         | —           | Carousel          |
| Rider Controls | —     | ✓         | ✓           | Lottie            |
| Tamper Center  | ✓     | ✓         | —           | —                 |
| Admin Tables   | ✓     | —         | —           | —                 |

---

# **7. Non-Functional Requirements**

* Smooth transitions (Reanimated 3)
* Offline caching
* Secure local storage (expo-secure-store)
* Crash-free (Sentry optional)
* Min 30 FPS on low-end Android phones
* All screens designed for 5.5–6.8” screens

---

# **8. Future Enhancements (Optional for Thesis)**

* Rider biometrics for “unlock override”
* Multi-parcel partitioned top box
* Box temperature sensor
* Smart route deviation detection
* Motion tracking & tilt detection


