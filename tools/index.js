import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { connectDB, disconnectDB } from "../db/config.js";
import mongoose from "mongoose";
import { DateTime } from "luxon";

const Patient = mongoose.connection.model(
    "Patient",                                // model name inside this service
    new mongoose.Schema({}, { strict: false }), // allow any fields
    "patients"                                // actual MongoDB collection name
);

const Appointment = mongoose.connection.model(
    "Appointment",
    new mongoose.Schema({}, { strict: false }),
    "appointments"
);
const Doctor = mongoose.connection.model(
    "Doctor",
    new mongoose.Schema({}, { strict: false }),
    "doctors"
);
const bookAppointment = tool(
    async ({ patientid, docname, docPhoneNo, date }) => {
        try {


            // 1. Find Patient
            const existancePatient = await Patient.findById(patientid);
            if (!existancePatient) {
                return "❌ Patient not found.";
            }
            // 2. Find Doctor by name + phone
            const doctor = await Doctor.findOne({ name: docname, phone: Number(docPhoneNo) });
            if (!doctor) {
                return "❌ Doctor not found.";
            }
            // 3. Construct appointment datetime in IST
            const [hour, minute] = doctor.availableHours.start.split(":").map(Number);
            const appointmentDateTime = DateTime.fromISO(date, { zone: "Asia/Kolkata" })
                .set({ hour, minute, second: 0, millisecond: 0 });

            if (!appointmentDateTime.isValid) {
                return "❌ Invalid date or time provided.";
            }

            const appointmentDate = appointmentDateTime.toJSDate();

            // ✅ NEW RULE 1: Appointment date must be within next 7 days
            const today = DateTime.now().setZone("Asia/Kolkata").startOf("day");
            const lastAllowedDay = today.plus({ days: 6 }).endOf("day");

            if (appointmentDateTime < today || appointmentDateTime > lastAllowedDay) {
                return "⚠️ You can only book appointments within the next 7 days.";
            }

            // ✅ NEW RULE 2: Check doctor availability (weekday must match doctor.availability)
            const appointmentDayName = appointmentDateTime.toFormat("EEEE"); // e.g. "Monday"
            if (!doctor.availability.includes(appointmentDayName)) {
                return `⚠️ Doctor is not available on ${appointmentDayName}. Available days: ${doctor.availability.join(", ")}.`;
            }
            // 4. Duplicate check
            const existingAppointment = await Appointment.findOne({
                patientId: existancePatient._id,
                doctorId: doctor._id,
                date: appointmentDate,
                status: "Pending"
            });

            if (existingAppointment) {
                return "⚠️ You already have an appointment with this doctor on the same date.";
            }
            // 5. Max appointments check
            const appointmentCount = await Appointment.countDocuments({
                doctor: doctor._id,
                date: appointmentDate,
            });

            if (appointmentCount >= doctor.maxAppointmentsPerDay) {
                return "⚠️ Doctor has already reached the maximum number of appointments for this day.";
            }
            // 6. Time gap check (at least 3 hours before appointment)
            const now = DateTime.now().setZone("Asia/Kolkata");
            const timeDifferenceHours = appointmentDateTime.diff(now, "hours").hours;

            if (timeDifferenceHours < 3) {
                return "⚠️ Appointments must be booked at least 3 hours in advance.";
            }
            // 7. Cancellation check
            const isCanceled = doctor.cancellations?.some(entry =>
                DateTime.fromJSDate(entry.date).setZone("Asia/Kolkata").toISODate() ===
                appointmentDateTime.setZone("Asia/Kolkata").toISODate()
            );

            if (isCanceled) {
                return "⚠️ Doctor is not available on the selected day.";
            }
            // 8. Create Appointment
            const appointment = await Appointment.create({
                patientId: existancePatient._id,
                patient: existancePatient.name,
                doctor: doctor.name,
                doctorId: doctor._id,
                date: appointmentDate,
                status: "Pending",
                time: doctor.availableHours.start,
                specialization: doctor.specialization, // taken from doctor schema
                fees: doctor.fees,
                tax: Number(process.env.APPOINTMENT_TAX || 0),
            });
            await Patient.updateOne(
                { _id: existancePatient._id },
                { $push: { appointment: appointment._id } }
            );

            // Update doctor (local schema, but we can also use $push for efficiency)
            await Doctor.updateOne(
                { _id: doctor._id },
                { $push: { appointments: appointment._id } }
            );

            return `✅ Appointment booked successfully with Dr. ${doctor.name} on ${appointmentDate.toLocaleDateString()} at ${doctor.availableHours.start}.`;
        } catch (error) {
            console.error("Error booking appointment tool:", error);
            return "❌ Failed to book appointment. Please try again later.";
        }

    },
    {
        name: "book_appointment_tool",
        description:
            "Book an appointment with a doctor by providing patient id, doctor name,Doctor's phone number, date.",
        schema: z.object({
            patientid: z.string().describe("The unique ID of the patient"),
            docname: z.string().describe("The doctor's name"),
            docPhoneNo: z.string().describe("The doctor's 10-digit phone number"),
            date: z.string().describe("Appointment date in YYYY-MM-DD format"),

        }),
    }
);
const cancelAppointment = tool(
    async ({ patientid, date }) => {
        try {
            // 1. Verify Patient exists
            const patient = await Patient.findById(patientid);
            if (!patient) return "❌ Patient not found.";

            // 2. Convert given date into JS Date (ignore time)
            const targetDay = DateTime.fromISO(date, { zone: "Asia/Kolkata" })
                .startOf("day")
                .toJSDate();
            const nextDay = DateTime.fromISO(date, { zone: "Asia/Kolkata" })
                .endOf("day")
                .toJSDate();

            // 3. Find appointment by patient + date range
            const appointment = await Appointment.findOne({
                patientId: patient._id,
                date: { $gte: targetDay, $lte: nextDay },
                status: "Pending",
            });

            if (!appointment) {
                return "⚠️ No active appointment found for this patient on the given date.";
            }

            // 4. Get Doctor
            const doctor = await Doctor.findById(appointment.doctorId);
            if (!doctor) return "❌ Doctor not found.";

            // 5. Remove appointment reference
            await Patient.updateOne(
                { _id: patient._id },
                { $pull: { appointment: appointment._id } }
            );

            await Doctor.updateOne(
                { _id: doctor._id },
                { $pull: { appointments: appointment._id } }
            );

            // 6. Mark appointment as canceled
            await Appointment.updateOne(
                { _id: appointment._id },
                { $set: { status: "Cancel" } }
            );

            return `✅ Appointment with Dr. ${doctor.name} on ${appointment.date.toLocaleDateString()} has been canceled successfully.`;
        } catch (error) {
            console.error("Error canceling appointment tool:", error);
            return "❌ Failed to cancel appointment. Please try again later.";
        }
    },
    {
        name: "cancel_appointment_tool",
        description: "Cancel an appointment by providing patient id and date.",
        schema: z.object({
            patientid: z.string().describe("The unique ID of the patient"),
            date: z.string().describe("The appointment date in YYYY-MM-DD format"),
        }),
    }
);
const updatePatientName = tool(
  async ({ patientid, newName }) => {
    try {
      const patient = await Patient.findById(patientid);
      if (!patient) return "❌ Patient not found.";

      await Patient.updateOne(
        { _id: patientid },
        { $set: { name: newName } }
      );

      return `✅ Patient name updated successfully to ${newName}.`;
    } catch (error) {
      console.error("Error updating name:", error);
      return "❌ Failed to update patient name.";
    }
  },
  {
    name: "update_patient_name",
    description: "Update a patient's name by providing patient id and new name.",
    schema: z.object({
      patientid: z.string().describe("The unique ID of the patient"),
      newName: z.string().describe("The new name for the patient"),
    }),
  }
);

const updatePatientEmail = tool(
  async ({ patientid, newEmail }) => {
    try {
      const patient = await Patient.findById(patientid);
      if (!patient) return "❌ Patient not found.";

      await Patient.updateOne(
        { _id: patientid },
        { $set: { email: newEmail } }
      );

      return `✅ Patient email updated successfully to ${newEmail}.`;
    } catch (error) {
      if (error.code === 11000) {
        return "⚠️ This email is already in use.";
      }
      console.error("Error updating email:", error);
      return "❌ Failed to update patient email.";
    }
  },
  {
    name: "update_patient_email",
    description: "Update a patient's email by providing patient id and new email.",
    schema: z.object({
      patientid: z.string().describe("The unique ID of the patient"),
      newEmail: z.string().email().describe("The new email for the patient"),
    }),
  }
);
const updatePatientPhone = tool(
  async ({ patientid, newPhone }) => {
    try {
      const patient = await Patient.findById(patientid);
      if (!patient) return "❌ Patient not found.";

      if (!/^\d{10}$/.test(newPhone)) {
        return "⚠️ Please provide a valid 10-digit phone number.";
      }

      await Patient.updateOne(
        { _id: patientid },
        { $set: { phone: Number(newPhone) } }
      );

      return `✅ Patient phone number updated successfully to ${newPhone}.`;
    } catch (error) {
      if (error.code === 11000) {
        return "⚠️ This phone number is already in use.";
      }
      console.error("Error updating phone:", error);
      return "❌ Failed to update patient phone number.";
    }
  },
  {
    name: "update_patient_phone",
    description: "Update a patient's phone number by providing patient id and new phone number.",
    schema: z.object({
      patientid: z.string().describe("The unique ID of the patient"),
      newPhone: z.string().describe("The new 10-digit phone number"),
    }),
  }
);
const viewAppointments = tool(
  async ({ patientid }) => {
    try {
      const Appointment = mongoose.connection.model(
        "Appointment",
        new mongoose.Schema({}, { strict: false }),
        "appointments"
      );

      const appointments = await Appointment.find({
        patientId: patientid,
      }).sort({ date: 1 });

      if (!appointments || appointments.length === 0) {
        return "⚠️ No appointments found for this patient.";
      }

      return appointments.map(appt => ({
        doctor: appt.doctor,
        date: new Date(appt.date).toLocaleDateString(),
        time: appt.time,
        status: appt.status,
        specialization: appt.specialization,
        fees: appt.fees,
      }));
    } catch (error) {
      console.error("Error viewing appointments:", error);
      return "❌ Failed to fetch appointments.";
    }
  },
  {
    name: "view_patient_appointments",
    description: "Fetch all appointments for a patient by patient id.",
    schema: z.object({
      patientid: z.string().describe("The unique ID of the patient"),
    }),
  }
);
const viewReports = tool(
  async ({ patientid }) => {
    try {
      const Patient = mongoose.connection.model(
        "Patient",
        new mongoose.Schema({}, { strict: false }),
        "patients"
      );

      const patient = await Patient.findById(patientid);
      if (!patient) return "❌ Patient not found.";

      if (!patient.reports || patient.reports.length === 0) {
        return "⚠️ No reports found for this patient.";
      }

      // Assuming each report has { name, link } stored in schema
      return patient.reports.map((report, idx) => ({
        reportNo: idx + 1,
        name: report.name || `Report ${idx + 1}`,
        link: report.link || "#", // frontend can open/download this
      }));
    } catch (error) {
      console.error("Error viewing reports:", error);
      return "❌ Failed to fetch reports.";
    }
  },
  {
    name: "view_patient_reports",
    description: "Fetch all medical reports for a patient by patient id.",
    schema: z.object({
      patientid: z.string().describe("The unique ID of the patient"),
    }),
  }
);


export const tools = [bookAppointment, cancelAppointment,updatePatientName,updatePatientEmail,updatePatientPhone,viewAppointments,viewReports];

