const fs = require('fs')
const path = require('path')
var request = require('sync-request')
const spawn = require('child_process').spawn

var args = process.argv
let NN_TYPE = 'style_transfer'
let fps = 25
let req_image_key = 'contentImage' 

if (args.length > 2) {
	NN_TYPE = args[2]
	fps = args[3]
}

if (NN_TYPE === 'style_transfer') {
	req_image_key = 'contentImage'
	res_image_key = 'stylizedImage'
}

const input_dir = path.join(__dirname, 'input')
const input_frames_dir = path.join(__dirname, 'input_frames')
const processed_frames_dir = path.join(__dirname, 'processed_frames')
const output_dir = path.join(__dirname, 'output')
const ffmpeg_stderr_path = path.join(__dirname, `ffmpeg_stderr.log`)

function base64_encode(file) {
    var bitmap = fs.readFileSync(file)
    return new Buffer(bitmap).toString('base64')
}

function clear_dir(dir_path) {
  const directory = dir_path

  fs.readdir(directory, (err, files) => {
    if (err) throw err

    for (const file of files) {
      fs.unlink(path.join(directory, file), err => {
        if (err) throw err
      })
    }
  })
}

function assemble_video_from_frames() {

	return new Promise((resolve, reject) => {
		const cmd = 'ffmpeg'
		console.log('FPS', fps)
		const args = [
		  '-y',
		  '-f', 'image2',
		  '-framerate', fps,
		  '-pattern_type', 'sequence',
		  '-start_number', '1',
		  '-r', fps, 
		  '-i', path.join(processed_frames_dir, 'image-%07d.jpeg'),
		  path.join(output_dir, 'output.mp4')
		]

		const proc = spawn(cmd, args)

		proc.stderr.setEncoding("utf8")
		proc.stderr.on('data', (data) => {
			fs.appendFile(ffmpeg_stderr_path, data, (err) => {
                if (err) {
                    console.log('File write errpr: ', err)
                } 
            })
      	})

		proc.on('close', (code) => {
			console.log('Done assembling video, code:', code)
			if (code === 0) {
				// clear_dir(input_frames_dir)
				// clear_dir(processed_frames_dir)
				resolve()
			}
		})
	})
}

function process_frames() {

	return new Promise((resolve, reject) => {

		const base64_input_arr = []

		const files = fs.readdirSync(input_frames_dir)

		files.forEach( (file) => { 
			filename = file.split('.').slice(0, -1).join('.')
			const base64 = 'data:image/png;base64,' + base64_encode(path.join(input_frames_dir, filename + '.png'))
			const input_img = { [req_image_key]: base64 } 
			base64_input_arr.push([filename, input_img])
		})

		base64_output_arr = []

		base64_input_arr.forEach((image_obj, i) =>  {

			console.log(`Processing frame ` + (i+1) + '/' + base64_input_arr.length)
			console.log(image_obj)
			const res = request('POST', 'http://localhost:8000/query', {
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				json: image_obj[1]
			})

			const base64 = JSON.parse(res.body)

			const base64Data = base64[res_image_key].split(',').pop()

			const processed_frame_path = path.join(processed_frames_dir, image_obj[0] + '.jpeg')

			fs.writeFileSync(processed_frame_path, base64Data, 'base64')

		})

  		resolve()
	})     
}

function input_video_to_frames() {

	return new Promise((resolve, reject) => {

		const input_video = fs.readdirSync(input_dir)[0]

		const cmd = 'ffmpeg'

		const args = [
			'-hide_banner',
			'-y',
			'-r', fps,
			'-i', path.join(__dirname, 'input', input_video),
			path.join(input_frames_dir, 'image-%07d.png')
		]

		const proc = spawn(cmd, args)

		proc.stderr.setEncoding("utf8")
		proc.stderr.on('data', (data) => {
			fs.appendFile(ffmpeg_stderr_path, data, (err) => {
                if (err) {
                    reject(err)
                } 
            })
      	})

		proc.on('close', () => {
			console.log('Video segmentation ended, going to process')
		      // STEP 2
			resolve()      
		})
	}) 
}

input_video_to_frames(fps)
	.then(process_frames)
	.then(assemble_video_from_frames)
	.catch(err => console.log(err))






