const PreExamEligibility = require("../Models/conductexampreexameligibilityds");
const ProgramwiseAccess = require("../Models/programwiseaccessds");
const MPrograms = require("../Models/mprograms");
const Users = require("../Models/user");
const RegulationCourseMap = require("../Models/regulationcoursemapds");
const ConductExam = require("../Models/conductexamds");

const text = (value) => String(value || "").trim();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const uniqueSorted = (values = []) => [...new Set(values.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const truthyRoleAll = (role) => /^(all|admin)$/i.test(text(role));
const uniquePrograms = (rows = []) => {
  const seen = new Map();
  rows.forEach((row) => {
    const code = text(row.programcode);
    if (!code) return;
    const name = text(row.program);
    if (!seen.has(code)) seen.set(code, { program: name, programcode: code });
    else if (!seen.get(code).program && name) seen.set(code, { program: name, programcode: code });
  });
  return [...seen.values()].sort((a, b) => `${a.program} ${a.programcode}`.localeCompare(`${b.program} ${b.programcode}`, undefined, { numeric: true }));
};

const queryFrom = (source = {}) => {
  const query = { colid: num(source.colid) };
  ["academicyear", "regulation", "examcode", "programcode", "semester", "coursecode", "regno", "status", "attendance", "fees"].forEach((field) => {
    if (text(source[field])) query[field] = text(source[field]);
  });
  return query;
};

const payload = (body = {}) => ({
  colid: num(body.colid),
  academicyear: text(body.academicyear),
  regulation: text(body.regulation),
  exam: text(body.exam),
  examcode: text(body.examcode),
  program: text(body.program),
  programcode: text(body.programcode),
  semester: text(body.semester),
  course: text(body.course),
  coursecode: text(body.coursecode),
  student: text(body.student || body.name),
  regno: text(body.regno),
  email: text(body.email),
  attendance: /^yes$/i.test(text(body.attendance)) ? "Yes" : "No",
  fees: /^yes$/i.test(text(body.fees)) ? "Yes" : "No",
  note: text(body.note),
  status: text(body.status) || "Active",
  user: text(body.user)
});

const allowedProgramCodes = async ({ colid, useremail, role }) => {
  if (truthyRoleAll(role)) return null;
  if (!text(useremail)) return null;
  const access = await ProgramwiseAccess.find({ colid, useremail: text(useremail) }).select("programcode").lean();
  return uniqueSorted(access.map((row) => row.programcode));
};

exports.options = async (req, res) => {
  try {
    const colid = num(req.query.colid);
    if (!colid) return res.status(400).json({ success: false, message: "colid is required" });
    const allowed = await allowedProgramCodes({ colid, useremail: req.query.useremail, role: req.query.role });
    const programFilter = { colid };
    if (Array.isArray(allowed)) programFilter.programcode = allowed.length ? { $in: allowed } : "__no_access__";
    const studentFilter = { colid, role: /^Student$/i };
    if (Array.isArray(allowed)) studentFilter.programcode = allowed.length ? { $in: allowed } : "__no_access__";
    const [programs, exams, courseMapRows, studentSourceRows] = await Promise.all([
      MPrograms.find(programFilter).select("year program programcode department faculty institution").sort({ year: -1, program: 1 }).lean(),
      ConductExam.find({ colid }).select("academicyear regulation examname exam examcode program programcode semester").sort({ academicyear: -1, examcode: 1 }).lean(),
      RegulationCourseMap.find(programFilter).select("academicyear regulation program programcode semester course coursecode").lean(),
      Users.find(studentFilter).select("academicyear regulation program programcode semester section").lean()
    ]);
    const scopedExams = Array.isArray(allowed) ? exams.filter((row) => !text(row.programcode) || allowed.includes(text(row.programcode))) : exams;
    const scopedCourseMapRows = Array.isArray(allowed) ? courseMapRows.filter((row) => allowed.includes(text(row.programcode))) : courseMapRows;
    res.json({
      success: true,
      programs,
      exams: scopedExams,
      options: {
        academicyears: uniqueSorted([...programs.map((row) => row.year), ...scopedExams.map((row) => row.academicyear), ...scopedCourseMapRows.map((row) => row.academicyear)]),
        regulations: uniqueSorted([...scopedExams.map((row) => row.regulation), ...scopedCourseMapRows.map((row) => row.regulation)]),
        semesters: uniqueSorted(scopedCourseMapRows.map((row) => row.semester)),
        statuses: ["Active", "Inactive"],
        studentFilterOptions: {
          academicyears: uniqueSorted(studentSourceRows.map((row) => row.academicyear)),
          regulations: uniqueSorted(studentSourceRows.map((row) => row.regulation)),
          programs: uniquePrograms(studentSourceRows),
          programcodes: uniqueSorted(studentSourceRows.map((row) => row.programcode)),
          semesters: uniqueSorted(studentSourceRows.map((row) => row.semester)),
          sections: uniqueSorted(studentSourceRows.map((row) => row.section))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.students = async (req, res) => {
  try {
    const colid = num(req.query.colid);
    const filter = { colid, role: /^Student$/i };
    ["academicyear", "regulation", "program", "programcode", "semester", "section"].forEach((field) => {
      if (text(req.query[field])) filter[field] = text(req.query[field]);
    });
    if (text(req.query.student)) filter.name = new RegExp(text(req.query.student).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (text(req.query.name)) filter.name = new RegExp(text(req.query.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (text(req.query.regno)) filter.regno = new RegExp(text(req.query.regno).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (text(req.query.email)) filter.email = new RegExp(text(req.query.email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    let students = await Users.find(filter).select("name email regno academicyear regulation program programcode semester section").sort({ name: 1 }).limit(5000).lean();
    if (!students.length && text(req.query.regulation)) {
      const fallback = { ...filter };
      delete fallback.regulation;
      students = await Users.find(fallback).select("name email regno academicyear regulation program programcode semester section").sort({ name: 1 }).limit(5000).lean();
    }
    res.json({ success: true, data: students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.courses = async (req, res) => {
  try {
    const colid = num(req.query.colid);
    const filter = { colid };
    ["academicyear", "regulation", "programcode", "semester"].forEach((field) => {
      if (text(req.query[field])) filter[field] = text(req.query[field]);
    });
    const courses = await RegulationCourseMap.find(filter).select("academicyear regulation program programcode semester subject type course coursecode").sort({ semester: 1, course: 1 }).limit(5000).lean();
    res.json({ success: true, data: courses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.list = async (req, res) => {
  try {
    const colid = num(req.query.colid);
    if (!colid) return res.status(400).json({ success: false, message: "colid is required" });
    const query = queryFrom(req.query);
    const allowed = await allowedProgramCodes({ colid, useremail: req.query.useremail, role: req.query.role });
    if (Array.isArray(allowed)) {
      if (!allowed.length) query.programcode = "__no_access__";
      else if (query.programcode) query.programcode = { $in: allowed, $eq: query.programcode };
      else query.programcode = { $in: allowed };
    }
    const data = await PreExamEligibility.find(query).sort({ academicyear: -1, examcode: 1, programcode: 1, semester: 1, student: 1, course: 1 }).lean();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.save = async (req, res) => {
  try {
    const base = payload(req.body);
    if (!base.colid || !base.academicyear || !base.regulation || !base.examcode || !base.programcode || !base.semester) {
      return res.status(400).json({ success: false, message: "Academic year, regulation, exam, program and semester are required" });
    }
    const students = Array.isArray(req.body.students) ? req.body.students : [{ student: base.student, regno: base.regno, email: base.email }];
    const courses = Array.isArray(req.body.courses) ? req.body.courses : [{ course: base.course, coursecode: base.coursecode }];
    const saved = [];
    for (const student of students) {
      for (const course of courses) {
        const item = { ...base, student: text(student.student || student.name), regno: text(student.regno), email: text(student.email), course: text(course.course), coursecode: text(course.coursecode) };
        if (!item.regno || !item.coursecode) continue;
        const data = await PreExamEligibility.findOneAndUpdate(
          { colid: item.colid, academicyear: item.academicyear, regulation: item.regulation, examcode: item.examcode, programcode: item.programcode, semester: item.semester, coursecode: item.coursecode, regno: item.regno },
          item,
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );
        saved.push(data);
      }
    }
    if (!saved.length) return res.status(400).json({ success: false, message: "Select at least one student and one course" });
    res.json({ success: true, data: saved, saved: saved.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const colid = num(req.body.colid);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [req.body.id].filter(Boolean);
    if (!colid || !ids.length) return res.status(400).json({ success: false, message: "Select at least one row" });
    const result = await PreExamEligibility.deleteMany({ colid, _id: { $in: ids } });
    res.json({ success: true, deleted: result.deletedCount || 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulk = async (req, res) => {
  try {
    const colid = num(req.body.colid);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!colid || !rows.length) return res.status(400).json({ success: false, message: "No rows received" });
    let saved = 0;
    const errors = [];
    for (const [index, row] of rows.entries()) {
      const item = payload({ ...row, colid, user: req.body.user || row.user });
      if (!item.academicyear || !item.regulation || !item.examcode || !item.programcode || !item.semester || !item.regno || !item.coursecode) {
        errors.push({ row: index + 2, message: "Missing required values" });
        continue;
      }
      await PreExamEligibility.findOneAndUpdate(
        { colid, academicyear: item.academicyear, regulation: item.regulation, examcode: item.examcode, programcode: item.programcode, semester: item.semester, coursecode: item.coursecode, regno: item.regno },
        item,
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
      saved += 1;
    }
    res.json({ success: true, saved, errors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.isStudentBarredForCourses = async ({ colid, academicyear, regulation, examcode, programcode, semester, regno, coursecodes }) => {
  const query = {
    colid: num(colid),
    academicyear: text(academicyear),
    regulation: text(regulation),
    examcode: text(examcode),
    programcode: text(programcode),
    semester: text(semester),
    regno: text(regno),
    coursecode: { $in: (coursecodes || []).map(text).filter(Boolean) },
    status: { $not: /^Inactive$/i }
  };
  return PreExamEligibility.find(query).lean();
};
