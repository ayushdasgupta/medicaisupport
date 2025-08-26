import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export const isAuthPatient = async (req, res, next) => {
    try {


        const Patient = mongoose.connection.model(
            "Patient",
            new mongoose.Schema({}, { strict: false }),
            "patients"
        );
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ success: false, message: "Access denied. Please log in." });
        }

        const decodedId = jwt.verify(token, process.env.JWT_SECRET);
        const patient = await Patient.findById(decodedId).select('-password');
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found." });
        }
        req.patient = patient;
        next();
    } catch (error) {
        console.error("Authentication error:", error.message);
        res.status(401).json({ success: false, message: "Invalid or expired token." });
    }
};
