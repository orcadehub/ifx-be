import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import pool from "./config/db.js"; // ✅ Make sure this is your PostgreSQL pool

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

// ✅ Middleware
app.use(
  cors({
    origin: ["https://www.influexkonnect.com", "http://localhost:5173"], // ✅ Remove trailing slash
    credentials: true,
  })
);
app.use(express.json());

// ✅ Routes
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

// ✅ Setup Socket.IO with HTTP server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://www.influexkonnect.com", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Socket.IO Logic
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Join user-specific room
  socket.on("join", (userId) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined room user-${userId}`);
  });

  // Handle message sending
  socket.on("send_message", async ({ to, content, token }) => {
    try {
      if (!token || !to || !content) return;

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const from = decoded.id;

      const result = await pool.query(
        "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING id",
        [from, to, content]
      );

      const messageId = result.rows[0].id;
      const message = { id: messageId, from, to, text: content };

      // Emit to both sender and receiver
      io.to(`user-${from}`).emit("new_message", message);
      io.to(`user-${to}`).emit("new_message", message);

      console.log("📩 Message sent via socket:", message);
    } catch (err) {
      console.error("❌ Error sending message via socket:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// ✅ Start Server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
