import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import pool from "./config/db.js";

// Routes
import authRoutes from "./routes/authRoutes.js";
import dataDeletionRoutes from "./routes/dataDeletionRoutes.js";
import chatRoute from "./routes/chat_route.js";
import otpRoute from "./routes/otp_route.js";
import userRoutes from "./routes/user_route.js";
import fbRoute from "./routes/fb_login.js";
import fbRouters from "./routes/fb_routes.js";
import googleAuthRoutes from "./routes/google_routes.js";
import fileRoutes from "./routes/file_route.js";
import paymentRoutes from "./routes/payment_route.js";

dotenv.config();

const app = express();

// CORS Middleware
app.use(
  cors({
    origin: ["https://ifx-be-orcadehubs-projects.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api", authRoutes);
app.use("/api", dataDeletionRoutes);
app.use("/api", chatRoute);
app.use("/api", otpRoute);
app.use("/api", fbRoute);
app.use("/api/connect", fbRouters);
app.use("/api", fileRoutes);
app.use("/api", paymentRoutes);
app.use("/api", userRoutes);
app.use("/api", googleAuthRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Server is working");
});

// Setup HTTP server (Render handles HTTPS automatically)
const server = http.createServer(app);

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: ["https://ifx-be-orcadehubs-projects.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // Allow polling as fallback
});

// Socket.IO Logic
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Middleware to verify token
  socket.use((packet, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      console.error("No token provided for socket:", socket.id);
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      console.error("Invalid token for socket:", socket.id, err.message);
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Error handler
  socket.on("error", (err) => {
    console.error("Socket error:", socket.id, err.message);
    socket.emit("error", { message: err.message });
  });

  // Join user-specific room
  socket.on("join", (userId) => {
    if (socket.user.id !== userId) {
      console.error("User ID mismatch for socket:", socket.id);
      return socket.emit("error", { message: "User ID mismatch" });
    }
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined room user-${userId}`);
  });

  // Handle message sending
  socket.on("send_message", async ({ to, content, tempId, token }, callback) => {
    try {
      if (!to || !content || !tempId) {
        console.error("Missing required fields for socket:", socket.id);
        return callback({ error: "Missing required fields" });
      }

      const from = socket.user.id;

      const result = await pool.query(
        "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING id, timestamp",
        [from, to, content]
      );

      const messageId = result.rows[0].id;
      const timestamp = result.rows[0].timestamp;
      const message = { id: messageId, from, to, text: content, tempId, timestamp };

      // Emit to both sender and receiver
      io.to(`user-${from}`).emit("new_message", message);
      io.to(`user-${to}`).emit("new_message", message);

      console.log("📩 Message sent via socket:", message);
      callback({ success: true, message });
    } catch (err) {
      console.error("❌ Error sending message via socket:", socket.id, err.message);
      callback({ error: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// Start Server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`✅ Server running on ${process.env.NODE_ENV === "production" ? "https" : "http"}://localhost:${PORT}`)
);