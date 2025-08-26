import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI;

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ MongoDB connected");
    } catch (error) {
        console.error("❌ Error connecting to MongoDB:", error);
        throw error;
    }
}

export const disconnectDB = async () =>  {
    try {
        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected");
    } catch (error) {
        console.error("❌ Error disconnecting from MongoDB:", error);
        throw error;
    }
}

