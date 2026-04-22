# Kafka Event Enrichment Pipeline 🚀

Welcome to the **Kafka Event Enrichment Pipeline**! This is a visually stunning, real-time data processing dashboard built for hackathons to demonstrate how modern, large-scale systems handle data.

## 🎯 What does it do?

Imagine you have thousands of users clicking buttons on a website (like "Purchase" or "Login"). These clicks are **"Raw Events"**. They contain a User ID, but no other details. 

This project takes those raw events and **"enriches"** them by looking up the user's full profile (name, membership tier) and combining everything into one complete, useful package of data. 

### The Workflow:
1. **Producer:** Sends raw, basic events to a Kafka topic.
2. **Consumer:** Picks up these events in real-time.
3. **API Lookup:** The consumer asks a Mock API for the user's full details.
4. **Enrichment:** It merges the raw event with the user's details.
5. **Publish:** The final, enriched event is sent to a new Kafka topic, ready for analytics or databases!

## ✨ Cool Features Built-In

- **Idempotency (No Duplicates):** We use **Redis** to remember which events we've already processed so we never accidentally process the same event twice.
- **Smart Caching:** To avoid asking the API the same question over and over, we cache user profiles in **Redis**. This makes the pipeline lightning fast.
- **Fault Tolerance & Retries:** If the API goes down, the system doesn't crash. It intelligently retries 3 times. If it still fails, it safely parks the broken event in a **Dead Letter Queue (DLQ)** topic for engineers to look at later.
- **3D Interactive Dashboard:** The entire pipeline is visualized in real-time using a beautiful, 3D animated interface built with **Three.js** and **GSAP**. 

## 🛠️ Tech Stack
* **Message Broker:** Apache Kafka (Docker)
* **In-Memory Cache & State:** Redis (Docker)
* **Backend:** Node.js, `kafkajs`, `ioredis`
* **Frontend:** React, Three.js (`@react-three/fiber`), GSAP (for smooth animations)
* **Communication:** WebSockets (for real-time dashboard updates)

## 🚀 How to Run It

1. **Start the Infrastructure:**
   Ensure Docker is running, then start Kafka and Redis:
   ```bash
   docker-compose up -d
   ```

2. **Start the Backend Services:**
   Open a terminal and start the Mock API & WebSocket Server:
   ```bash
   node userService.js
   ```
   Open a second terminal and start the Consumer:
   ```bash
   node consumer.js
   ```

3. **Start the Frontend Dashboard:**
   Open a third terminal, go into the `frontend` folder, and run:
   ```bash
   cd frontend
   npm run dev:ui
   ```

4. **Run the Simulation!**
   Go to your web browser (`http://localhost:5173`), click the **Run Pipeline** button, and watch the events flow through the 3D pipeline! You can also manually trigger events by running `node producer.js`.

---
