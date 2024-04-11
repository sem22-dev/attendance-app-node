const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Resend } = require('resend');

const app = express();
const port = process.env.PORT || 5000;
require('dotenv').config();


app.use(cors());
app.use(bodyParser.json());

const resendApiKey = process.env.RESEND_API_KEY;
const mongodbUri = process.env.MONGODB_URI;

const resend = new Resend(resendApiKey);

// MongoDB connection
mongoose.connect(mongodbUri, { useNewUrlParser: true, useUnifiedTopology: true });
const connection = mongoose.connection;
connection.once('open', () => {
    console.log("MongoDB database connection established successfully");
});

// Define a schema
const Schema = mongoose.Schema;
const StudentSchema = new Schema({
    name: String,
    rrn: String,
    GuardianGmail: String,
});

// Create a model
const Student = mongoose.model('Student', StudentSchema);

const AttendanceSchema = new Schema({
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' }, // Reference to Student
    name: String,
    rrn: String,
    status: String,
    date: { type: String, required: true } // Store as a String
});

const Attendance = mongoose.model('Attendance', AttendanceSchema);

const ResultSchema = new Schema({
    name: String,
    rrn: String,
    sgpa: Number,
    subjects: [{
        subject: String,
        grade: String,
        credit: Number,
        gradePoint: Number,
        result: String
    }]
});


const Result = mongoose.model('Result', ResultSchema);




// Routes
app.get('/students', async (req, res) => {
    const students = await Student.find();
    console.log(students)
    res.json(students);
});

app.post('/add-student', async (req, res) => {
    const newStudent = new Student(req.body);
    await newStudent.save();
    res.status(201).json(newStudent);
});

// Update a student
app.put('/update-student/:id', async (req, res) => {
    const { id } = req.params;
    const { name, rrn,  GuardianGmail } = req.body;

    try {
        const updatedStudent = await Student.findByIdAndUpdate(id, {
            name,
            rrn,
             GuardianGmail
        }, { new: true }); // { new: true } ensures that the method returns the updated document.

        if (!updatedStudent) {
            return res.status(404).json({ message: "Student not found" });
        }

        res.json(updatedStudent);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Delete a student
app.delete('/delete-student/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deletedStudent = await Student.findByIdAndDelete(id);

        if (!deletedStudent) {
            return res.status(404).json({ message: "Student not found" });
        }

        res.json({ message: "Student successfully deleted", deletedStudent });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

app.post('/submit-attendance', async (req, res) => {
    try {
        // Ensure your client sends a 'date' field in 'YYYY-MM-DD' format
        const records = req.body.map(record => ({
            ...record,
            date: record.date // Directly use the provided date
        }));

        console.log('Attendance records received:', req.body);

        // Save attendance records to MongoDB
        const attendanceRecords = await Attendance.insertMany(records);

        // Get absent students
        const absentStudents = records.filter(record => record.status === 'absent');

        // Send emails to guardians of absent students
        for (const student of absentStudents) {
            const studentRRN = student.rrn;

            try {
                // Find the student by RRN and retrieve the Guardian's email
                const studentData = await Student.findOne({ rrn: studentRRN });
                const guardianEmail = studentData ? studentData.GuardianGmail : null;

                if (guardianEmail) {
                    await resend.emails.send({
                        from: 'dailyattendance@semjjonline.xyz',
                        to: guardianEmail,
                        subject: 'Absentee Notification',
                        html: `<p>Dear Guardian,\n\nYour child ${student.name} was absent on ${student.date}</p>`
                    });

                    console.log('Email sent successfully to', guardianEmail);
                } else {
                    console.log('Guardian email not found for student with RRN:', studentRRN);
                }
            } catch (error) {
                console.error('Error sending email:', error);
            }
        }

        res.status(201).json(attendanceRecords);
    } catch (error) {
        console.error('Error submitting attendance:', error);
        res.status(500).json({ message: 'Failed to submit attendance records', error: error.message });
    }
});
``


app.get('/attendance-today', async (req, res) => {

    const Todaydate = new Date().toLocaleDateString('en-CA');

    try {
        const attendanceRecordsToday = await Attendance.find({
            date: Todaydate
        });
        res.json(attendanceRecordsToday);
        console.log('todays att: ', attendanceRecordsToday)
    } catch (error) {
        console.error('Error fetching today\'s attendance:', error);
        res.status(500).json({ message: 'Failed to fetch today\'s attendance records', error: error.message });
    }
});

app.get('/available-dates', async (req, res) => {
    try {
        const availableDates = await Attendance.aggregate([
            {
                $group: {
                    _id: "$date"
                }
            },
            {
                $sort: { "_id": 1 } // Sort by date ascending
            }
        ]);

        // Extract dates from the aggregation result and send
        const dates = availableDates.map(item => item._id);
        res.json(dates);
    } catch (error) {
        console.error('Error fetching available dates:', error);
        res.status(500).json({ message: 'Failed to fetch available dates', error: error.message });
    }
});

app.get('/attendance-records', async (req, res) => {
    const { date } = req.query; // Expecting date in 'YYYY-MM-DD' format

    if (!date) {
        return res.status(400).json({ message: "Date parameter is required." });
    }

    try {
        const records = await Attendance.find({
            date: date
        }).populate('studentId', 'name rrn -_id'); // Assuming you want to populate student details

        res.json(records);
    } catch (error) {
        console.error('Error fetching attendance records:', error);
        res.status(500).json({ message: 'Failed to fetch attendance records for the selected date', error: error.message });
    }
});

app.post('/add-result', async (req, res) => {
    try {
        const { name, rrn, sgpa, subjects } = req.body;

        const resultData = {
            name,
            rrn,
            sgpa,
            subjects
        };

        // Here you can perform any necessary validation or processing of the resultData before saving it to the database

        const newResult = new Result(resultData);
        await newResult.save();
        
        res.status(201).json(newResult);
    } catch (error) {
        console.error('Error adding result:', error);
        res.status(500).json({ message: 'Failed to add result', error: error.message });
    }
});


app.get('/results', async (req, res) => {
    try {
        const results = await Result.find({}, 'name rrn sgpa'); // Fetch only name, rrn, and sgpa fields
        res.json(results);
    } catch (error) {
        console.error('Error fetching results:', error);
        res.status(500).json({ message: 'Failed to fetch results', error: error.message });
    }
});

app.get('/result-individual', async (req, res) => {
    const { rrn } = req.query; // Get RRN from query parameters

    try {
        if (!rrn) {
            return res.status(400).json({ message: "RRN parameter is required." });
        }

        const result = await Result.findOne({ rrn }, '-_id name rrn sgpa subjects'); // Fetch result based on RRN

        if (!result) {
            return res.status(404).json({ message: "Result not found for the provided RRN." });
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching result:', error);
        res.status(500).json({ message: 'Failed to fetch result', error: error.message });
    }
});





app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});

