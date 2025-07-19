import express from "express";
import pool from "../config/db.js";
const router = express.Router();
import dotenv from "dotenv";
dotenv.config();

const services = [
  {
    id: 1,
    title: "Product Review",
    platform: "YouTube",
    image: "https://picsum.photos/300/180?random=1",
    likes: "180K",
    views: "450K",
    comments: "720",
    shares: "9K",
  },
  {
    id: 2,
    title: "Travel Vlog",
    platform: "Twitter",
    image: "https://picsum.photos/300/180?random=2",
    likes: "220K",
    views: "600K",
    comments: "950",
    shares: "12K",
  },
  {
    id: 3,
    title: "Fitness Challenge",
    platform: "Instagram",
    image: "http://picsum.photos/300/180?random=3",
    likes: "195K",
    views: "520K",
    comments: "830",
    shares: "9K",
  },
  {
    id: 4,
    title: "Cooking Tips",
    platform: "Facebook",
    image: "https://picsum.photos/300/180?random=4",
    likes: "150K",
    views: "430K",
    comments: "600",
    shares: "8K",
  },
  {
    id: 5,
    title: "Unboxing",
    platform: "YouTube",
    image: "https://picsum.photos/300/180?random=5",
    likes: "200K",
    views: "550K",
    comments: "800",
    shares: "11K",
  },
];

// GET /influencers
router.get("/influencers", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         id, 
         fullname AS name, 
         email, 
         phone, 
         role, 
         profile_pic as profile_pic, 
         fb_username as username, 
         category, 
         stats, 
         prices, 
         data, 
         posts 
       FROM users 
       WHERE role = 'influencer'`
    );

    const influencers = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      username:
        row.username || (row.email ? row.email.split("@")[0] : "unknown_user"),
      category: row.category || "General",
      profilePic: row.profile_pic || "https://via.placeholder.com/100x100",
      stats: row.stats || {
        instagram: "0",
        facebook: "0",
        twitter: "0",
        youtube: "0",
      },
      prices: row.prices || {
        "Post Image/Video": "499₹",
        "Reels/Shorts": "499₹",
        "Story (Image/Video)": "499₹",
        "Short Video (<10m)": "499₹",
        "Video (>10m)": "499₹",
        Polls: "499₹",
      },
      data: row.data || {
        totalCampaigns: 0,
        avgLikes: 0,
        avgViews: "0",
        avgReach: "0",
        engagement: "0%",
        avgComments: 0,
        avgShares: 0,
        fakeFollowers: "0%",
      },
      posts: row.posts || [],
    }));

    res.status(200).json(influencers);
  } catch (err) {
    console.error("❌ Error fetching influencers:", err);
    res.status(500).json({ message: "❌ Failed to fetch influencers." });
  }
});

export default router;
