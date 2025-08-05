import express, { Router } from "express";
import Busboy from "busboy";
import pool from "../config/db.js";
import authenticateToken from "../middlewares/authMiddleware.js";
import Razorpay from "razorpay";
import crypto from "crypto";

const router = Router();



// Create Razorpay payment order
router.post("/create-payment-order", authenticateToken, async (req, res) => {
  const { amount, currency, orderId } = req.body;
//   console.log("Triggered Payment");

  try {
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_xxxxxxxxxxxxxx",
      key_secret: process.env.RAZORPAY_KEY_SECRET || "xxxxxxxxxxxxxxxxxxxxxxxx",
    });
    const options = {
      amount, // Amount in paisa
      currency,
      receipt: `order_${orderId}`,
    };


    const order = await instance.orders.create(options);
    res.json({
      razorpayOrderId: order.id,
      key: process.env.RAZORPAY_KEY_ID || "rzp_test_xxxxxxxxxxxxxx",
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    res.status(500).json({ message: "Failed to create payment order" });
  }
});

// Verify payment and update order status
router.post("/verify-payment", authenticateToken, async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, orderId } = req.body;

  try {
    // Verify Razorpay signature
    const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "xxxxxxxxxxxxxxxxxxxxxxxx");
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // Update order status to "Completed"
    const updateQuery = `
      UPDATE orders
      SET status = $1, updated_at = $2
      WHERE id = $3
      RETURNING *;
    `;
    const updateValues = ["Completed", new Date(), orderId];
    const result = await pool.query(updateQuery, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Payment verified and order updated successfully",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("Error verifying payment:", error.message);
    res.status(500).json({ message: "Failed to verify payment" });
  }
});

export default router;