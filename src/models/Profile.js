const mongoose = require('mongoose')
const Version = require('./common/Version.js')

const schema = new mongoose.Schema({
  _id: String,
  name: String,
  alert: {
    type: [String]
  },
  sources: Object,
  dateFormat: String,
  dateLanguage: String,
  timezone: String,
  prefix: String,
  locale: String
})

schema.add(Version)

exports.schema = schema
exports.model = mongoose.model('Profile', schema)
