# Software Design Documentation
## Parcel-Safe Smart Top Box System

---

## 1. Use Case Diagrams

### 1.1 Customer Use Case Diagram

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart LR
    Customer((Customer))
    
    UC1(["Login/Register"])
    UC2(["View Dashboard"])
    UC3(["Track Delivery"])
    UC4(["View OTP Code"])
    UC5(["Confirm Receipt"])
    UC6(["View Delivery History"])
    UC7(["View Photo Audit"])
    UC8(["Manage Profile"])
    
    Customer --- UC1
    Customer --- UC2
    Customer --- UC3
    Customer --- UC4
    Customer --- UC5
    Customer --- UC6
    Customer --- UC7
    Customer --- UC8
```

### 1.2 Rider Use Case Diagram

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart LR
    Rider((Rider))
    
    UC1(["Login"])
    UC2(["View Dashboard"])
    UC3(["View Assigned Deliveries"])
    UC4(["Navigate to Destination"])
    UC5(["Control Box Lock"])
    UC6(["Enter Customer OTP"])
    UC7(["Complete Delivery"])
    UC8(["View System Logs"])
    
    Rider --- UC1
    Rider --- UC2
    Rider --- UC3
    Rider --- UC4
    Rider --- UC5
    Rider --- UC6
    Rider --- UC7
    Rider --- UC8
```

---

## 2. UI Software Workflow

### 2.1 Customer App Workflow

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A[Open App] --> B[Login Screen]
    B --> C{Logged In?}
    C -->|No| D[Register Screen]
    D --> B
    C -->|Yes| E[Customer Dashboard]
    
    E --> F[Track Order]
    E --> G[View OTP]
    E --> H[Delivery History]
    E --> I[Profile]
    E --> J[Settings]
    
    F --> K[See Map]
    F --> L[See Details]
    
    G --> M[Show 6-Digit Code]
    M --> N[Timer Counting]
    
    H --> O[Past Deliveries]
    O --> P[See Recipient Photo]
    O --> Q[See Tamper Photo]
    
    style E fill:#e3f2fd
    style G fill:#fff9c4
    style P fill:#c8e6c9
    style Q fill:#ffcdd2
```

### 2.2 Rider App Workflow

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A[Open App] --> B[Login Screen]
    B --> C{Logged In?}
    C -->|No| B
    C -->|Yes| D[Rider Dashboard]
    
    D --> E[Go Online/Offline]
    D --> F[My Deliveries]
    D --> G[Box Controls]
    D --> H[Profile]
    
    F --> I[Pick Delivery]
    I --> J[See Details]
    J --> K[Navigate]
    
    G --> L[See Battery & GPS]
    G --> M[Lock/Unlock]
    G --> N[See Logs]
    G --> O[Emergency Open]
    
    K --> P{Arrived?}
    P -->|No| K
    P -->|Yes| Q[Type OTP]
    Q --> R{Correct?}
    R -->|No| Q
    R -->|Yes| S[Take Photo]
    S --> T[Unlock Box]
    T --> U[Give Parcel]
    U --> V[Lock Box]
    V --> W[Mark Done]
    
    style D fill:#e8f5e9
    style S fill:#fff9c4
    style W fill:#c8e6c9
```

---

## 3. System Pipeline Diagrams

### 3.1 Customer App Pipeline

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart LR
    subgraph Input
        A[Customer Taps Button]
    end
    
    subgraph "Mobile App"
        B[Show Screen]
        C[Get Data from Server]
    end
    
    subgraph Server
        D[Process Request]
        E[Save/Get from Database]
    end
    
    subgraph Output
        F[Display Result]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> D
    D --> C
    C --> B
    B --> F
```

### 3.2 Rider App Pipeline

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart LR
    subgraph Input
        A[Rider Taps Button]
        B[GPS Location]
    end
    
    subgraph "Mobile App"
        C[Show Screen]
        D[Send Command]
    end
    
    subgraph Server
        E[Process Request]
        F[Save to Database]
    end
    
    subgraph "Smart Box"
        G[Receive Command]
        H[Lock/Unlock]
        I[Read Sensors]
        J[Take Photo]
    end
    
    A --> C
    B --> D
    C --> D
    D --> E
    E --> F
    E --> G
    G --> H
    G --> I
    G --> J
    I --> G
    J --> G
    G --> E
    E --> D
    D --> C
```

### 3.3 Delivery Process Pipeline

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart LR
    subgraph "Step 1"
        A[Order Placed]
    end
    
    subgraph "Step 2"
        B[Assign Rider]
        C[Pickup Parcel]
        D[Lock Box]
    end
    
    subgraph "Step 3"
        E[Deliver]
        F[Track Location]
    end
    
    subgraph "Step 4"
        G[Arrive]
        H[Show OTP]
    end
    
    subgraph "Step 5"
        I[Enter OTP]
        J[Take Photo]
        K[Unlock Box]
        L[Give Parcel]
    end
    
    subgraph "Step 6"
        M[Done]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    K --> L
    L --> M
```

### 3.4 Photo Capture Pipeline

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    subgraph "When to Take Photo"
        A[OTP Correct]
        B[Tamper Detected]
    end
    
    subgraph "Camera"
        C[Turn On Camera]
        D[Take Photo]
    end
    
    subgraph "Save"
        E[Send to Server]
        F[Store in Database]
    end
    
    subgraph "Who Can View"
        G[Customer]
        H[Admin]
    end
    
    A --> C
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    F --> H
```

---

## 4. Detailed Flowcharts

### 4.1 Customer Tracking Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[/Open App/]
    B --> C{Logged In?}
    C -->|No| D[/Type Email & Password/]
    D --> E{Correct?}
    E -->|No| D
    E -->|Yes| F[Show Dashboard]
    C -->|Yes| F
    
    F --> G[/Tap Track Order/]
    G --> H{Have Delivery?}
    H -->|No| I[Show: No Orders]
    I --> J([End])
    
    H -->|Yes| K[Get Delivery Info]
    K --> L[Show Map]
    L --> M[Show Time Left]
    M --> N{Rider Here?}
    
    N -->|No| O[Update Map]
    O --> L
    
    N -->|Yes| P[Show OTP Screen]
    P --> Q[/Show 6-Digit Code/]
    Q --> R[Start Timer]
    R --> S{Code Used?}
    
    S -->|No| T{Time Up?}
    T -->|No| S
    T -->|Yes| U[New Code]
    U --> Q
    
    S -->|Yes| V[Show Photo]
    V --> W[Delivery Done]
    W --> J
    
    style A fill:#e1f5fe
    style J fill:#e1f5fe
    style V fill:#fff9c4
    style W fill:#c8e6c9
```

### 4.2 Rider Delivery Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[/Login/]
    B --> C[Show Dashboard]
    C --> D[/Pick a Delivery/]
    D --> E[Show Details]
    E --> F[/Tap Navigate/]
    F --> G[Open Maps]
    
    G --> H{At Location?}
    H -->|No| G
    H -->|Yes| I[Location Confirmed]
    
    I --> J[/Open Box Controls/]
    J --> K{Box Locked?}
    
    K -->|No| L[/Tap Lock/]
    L --> K
    
    K -->|Yes| M[/Ask for OTP/]
    M --> N[/Type OTP/]
    N --> O{Correct?}
    
    O -->|No| P[Show Error]
    P --> Q{Try Again?}
    Q -->|Yes| N
    Q -->|No| R([End - Failed])
    
    O -->|Yes| S[Take Photo of Person]
    S --> T[Save Photo]
    T --> U[Unlock Box]
    U --> V[/Give Parcel/]
    V --> W[/Lock Box/]
    W --> X[/Mark Done/]
    X --> Y([End - Success])
    
    style A fill:#e1f5fe
    style S fill:#fff9c4
    style Y fill:#c8e6c9
    style R fill:#ffcdd2
```

### 4.3 OTP Verification Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[Rider Arrives]
    B --> C{Near Location?}
    
    C -->|No| D[Move Closer]
    D --> C
    
    C -->|Yes| E[Create OTP Code]
    E --> F[Send to Customer]
    F --> G[Show 6-Digit Code]
    G --> H[Start 5-min Timer]
    
    H --> I[Customer Tells Code]
    I --> J[/Rider Types Code/]
    J --> K{Correct?}
    
    K -->|No| L[Add 1 to Tries]
    L --> M{Tried 3 Times?}
    M -->|Yes| N[Wait 5 mins]
    N --> O([End - Locked])
    
    M -->|No| P[Wrong Code]
    P --> J
    
    K -->|Yes| Q{Time Up?}
    Q -->|Yes| R[New Code]
    R --> F
    
    Q -->|No| S[Code Used]
    S --> T[Turn On Camera]
    T --> U[Take Photo of Person]
    U --> V[Save Photo]
    V --> W[Unlock Box]
    W --> X([End - Success])
    
    style A fill:#e1f5fe
    style T fill:#fff9c4
    style U fill:#fff9c4
    style X fill:#c8e6c9
    style O fill:#ffcdd2
```

### 4.4 Tamper Detection Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[Box Sensors Active]
    B --> C{Tampering?}
    
    C -->|No| D[Wait]
    D --> B
    
    C -->|Yes| E[Record Event]
    E --> F[Turn On Camera]
    F --> G[Take Photo]
    G --> H[Get Location]
    H --> I[Get Time]
    
    I --> J[Send to Server]
    J --> K[Save Photo]
    
    K --> L[Alert Customer]
    L --> M[Customer Sees Photo]
    
    M --> N([End])
    
    style A fill:#e1f5fe
    style C fill:#ffcdd2
    style F fill:#fff9c4
    style G fill:#fff9c4
    style L fill:#ffcdd2
    style N fill:#e1f5fe
```

### 4.5 Box Control Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[/Open Box Controls/]
    B --> C[Get Box Status]
    C --> D[Show Battery, GPS, Lock]
    
    D --> E{What to Do?}
    
    E -->|Lock/Unlock| F{Is Locked?}
    F -->|Yes| G[/Tap Unlock/]
    F -->|No| H[/Tap Lock/]
    G --> I[/Confirm/]
    H --> I
    I --> J[Send Command]
    J --> K[Save to Log]
    K --> L[Update Screen]
    
    E -->|Restart| M[/Tap Restart/]
    M --> N[/Confirm/]
    N --> O[Restart Box]
    O --> P[Wait 30s]
    P --> Q[Box Online]
    Q --> K
    
    E -->|Emergency| R[/Hold Button/]
    R --> S[/Confirm/]
    S --> T[Take Photo]
    T --> U[Force Open]
    U --> V[Make Report]
    V --> K
    
    L --> W([End])
    
    style A fill:#e1f5fe
    style W fill:#e1f5fe
    style T fill:#fff9c4
    style U fill:#ffcdd2
```

### 4.6 Login Flowchart

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[/Open App/]
    B --> C{Already Logged In?}
    
    C -->|Yes| D[Check if Valid]
    D --> E{Still Valid?}
    E -->|No| F[Log Out]
    F --> G[Show Login Screen]
    E -->|Yes| H[Get User Type]
    
    C -->|No| G
    G --> I[/Type Email & Password/]
    I --> J{Filled In?}
    J -->|No| K[Show Error]
    K --> I
    
    J -->|Yes| L[Check with Server]
    L --> M{Correct?}
    M -->|No| N[Wrong Login]
    N --> I
    
    M -->|Yes| O[Remember Login]
    O --> H
    
    H --> P{User Type?}
    P -->|Customer| Q[Customer App]
    P -->|Rider| R[Rider App]
    P -->|Admin| S[Admin App]
    
    Q --> T([End])
    R --> T
    S --> T
    
    style A fill:#e1f5fe
    style T fill:#e1f5fe
    style Q fill:#e3f2fd
    style R fill:#e8f5e9
    style S fill:#ffebee
```

### 4.7 Full Delivery Flow

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    A([Start]) --> B[Customer Orders]
    B --> C[Assign Rider]
    C --> D[Rider Gets Parcel]
    D --> E[Lock Box]
    
    E --> F[Start Trip]
    F --> G[Track with GPS]
    G --> H{Tampering?}
    
    H -->|Yes| I[Take Photo]
    I --> J[Alert Customer]
    J --> G
    
    H -->|No| K{Arrived?}
    K -->|No| G
    K -->|Yes| L[Show OTP to Customer]
    
    L --> M[Customer Tells OTP]
    M --> N[Rider Types OTP]
    N --> O{Correct?}
    
    O -->|No| P[Try Again]
    P --> N
    
    O -->|Yes| Q[Take Photo of Person]
    Q --> R[Save Photo]
    R --> S[Unlock Box]
    S --> T[Give Parcel]
    T --> U[Lock Box]
    U --> V[Done]
    V --> W([End])
    
    style A fill:#e1f5fe
    style I fill:#ffcdd2
    style J fill:#ffcdd2
    style Q fill:#c8e6c9
    style W fill:#e1f5fe
```

---

## Flowchart Shape Legend

| Shape | Syntax | Meaning |
|-------|--------|---------|
| Oval | `([Text])` | Start / End |
| Rectangle | `[Text]` | Process |
| Diamond | `{Text}` | Decision |
| Parallelogram | `[/Text/]` | Input / Output |
| Cylinder | `[(Text)]` | Database |
| Circle | `((Text))` | Actor |
| Stadium | `(["Text"])` | Use Case |

---

## Photo Capture Summary

| Event | Trigger | Purpose |
|-------|---------|---------|
| Recipient Photo | OTP Verified Successfully | Proof of delivery to correct person |
| Tamper Photo | Sensor Detects Anomaly | Evidence of tampering attempt |
| Emergency Photo | Force Open Activated | Document emergency access |

---

## Usage Instructions

1. Go to [https://mermaid.live](https://mermaid.live)
2. Copy code between \`\`\`mermaid and \`\`\`
3. Paste into editor
4. Export as PNG or SVG

---

## 8. Data Management Design

### 8.1 Data Flow Diagram (DFD)

The Data Flow Diagram illustrates the movement of data through the Parcel-Safe system, showing how information flows between external entities, processes, and data stores.

**See:** `diagrams/16-data-flow-diagram.drawio`

#### Data Value Chain

| Phase | Description | Data Elements |
|-------|-------------|---------------|
| **Source** | Data originates from users (mobile apps), IoT hardware (sensors, GPS, camera), and external services | User credentials, location coordinates, sensor readings, photos |
| **Collection** | Mobile apps and IoT devices transmit data via HTTPS/MQTT | Real-time telemetry, OTP requests, delivery updates |
| **Storage** | Firebase Firestore (NoSQL) and Cloud Storage | User profiles, delivery records, photos, logs |
| **Processing** | Cloud Functions handle OTP generation, notifications, analytics | Verification logic, alert triggers, report generation |
| **Analysis** | Admin dashboard displays aggregated insights | Delivery metrics, tamper patterns, system health |

#### Key Data Flows

1. **Authentication Flow**: User → Auth Process → User Data Store
2. **Delivery Management Flow**: Customer/Rider → Delivery Process → Delivery Data Store
3. **OTP Flow**: Customer Request → OTP Generation → OTP Store → Rider Verification → Box Control
4. **Tracking Flow**: GPS Service → Tracking Process → Location Data Store → Customer App
5. **Tamper Detection Flow**: Smart Box Sensors → Tamper Process → Alert Store → Admin Notification

---

### 8.2 Entity Relationship Diagram (ERD)

The ERD shows the database schema design for the Parcel-Safe system using Firebase Firestore (NoSQL).

**See:** `diagrams/17-entity-relationship-diagram.drawio`

#### Entity Summary

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| **USER** | System users (customers, riders, admins) | user_id, email, role, phone |
| **SMART_BOX** | Physical IoT box devices | box_id, owner_id, is_locked, telemetry |
| **DELIVERY** | Parcel delivery records | delivery_id, tracking_number, status, addresses |
| **OTP** | One-time passwords for verification | otp_id, code, expires_at, is_used |
| **PHOTO_AUDIT** | Captured photos for proof/audit | photo_id, image_url, photo_type |
| **TAMPER_ALERT** | Security breach notifications | alert_id, alert_type, severity |
| **LOCATION_LOG** | Real-time tracking history | log_id, latitude, longitude, timestamp |
| **BOX_EVENT_LOG** | Box control events | event_id, event_type, source |
| **NOTIFICATION** | Push notification records | notification_id, title, is_read |

#### Key Relationships

- USER (1) → (N) DELIVERY (customer receives, rider delivers)
- USER (1) → (N) SMART_BOX (owner)
- DELIVERY (1) → (N) OTP
- DELIVERY (1) → (N) PHOTO_AUDIT
- DELIVERY (1) → (N) LOCATION_LOG
- SMART_BOX (1) → (N) TAMPER_ALERT
- SMART_BOX (1) → (N) BOX_EVENT_LOG

---

### 8.3 Network Diagram

The Network Diagram shows the system architecture including all network zones, devices, and communication protocols.

**See:** `diagrams/18-network-diagram.drawio`

#### Network Zones

| Zone | Components | Purpose |
|------|------------|---------|
| **User Zone** | Customer Mobile, Rider Mobile, Admin Tablet/Web | Client applications |
| **Internet** | Public network with HTTPS/WSS protocols | Secure data transmission |
| **Cloud Services Zone** | Firebase Auth, Firestore, Storage, Functions, FCM, Maps API | Backend services |
| **IoT Edge Zone** | ESP32 MCU, Servo Lock, GPS, Camera, Sensors, GSM Module | Hardware components |

#### Communication Protocols

| Protocol | Port | Usage |
|----------|------|-------|
| HTTPS | 443 | REST API calls, Web traffic |
| WSS | 443 | Real-time WebSocket connections |
| MQTT | 8883 | IoT device communication |
| GSM/GPRS | N/A | Cellular backup for IoT |

#### Security Measures

- **TLS 1.3** encryption for all network traffic
- **OAuth 2.0** with Firebase Authentication
- **JWT tokens** for session management
- **End-to-end encryption** for sensitive data
- **Certificate pinning** in mobile apps

---

## Draw.io Diagram Files

| # | Diagram | File |
|---|---------|------|
| 16 | Data Flow Diagram | `16-data-flow-diagram.drawio` |
| 17 | Entity Relationship Diagram | `17-entity-relationship-diagram.drawio` |
| 18 | Network Diagram | `18-network-diagram.drawio` |

---

**Project:** Parcel-Safe Smart Top Box  
**Author:** Lorenzo Bela  
**Date:** December 2024
