const fs = require('fs')
const path = require('path')
const sync_request = require('sync-request')
const { spawn } = require('child_process')

const args = process.argv
let fps = 25

const model_args = []

if (args.length > 2) {
	model_name = args[2]

} else if (args.length > 3) {
	fps = args[3]
}

if (model_name === 'munit') {
	const style_index = args[4] ? args[4] : 0

	model_args.push(style_index)
}

const input_dir = path.join(__dirname, 'input')
const input_frames_dir = path.join(__dirname, 'input_frames')
const processed_frames_dir = path.join(__dirname, 'processed_frames')
const output_dir = path.join(__dirname, 'output')
const ffmpeg_stderr_path = path.join(__dirname, `ffmpeg_stderr.log`)

function create_dir(dir) {
	if (!fs.existsSync(dir)){
    fs.mkdirSync(dir)
	}	
}

function base64_encode(file) {
    const bitmap = fs.readFileSync(file)
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

function clear_file(file_path) {
	fs.truncate('/path/to/file', 0, ()=>{})
}

function create_requests_to_model(model_name, img_files, model_args) {

	return img_files.map((img_file) => { 

		filename = img_file.split('.').slice(0, -1).join('.')

		const base64_img = 'data:image/png;base64,' + base64_encode(path.join(input_frames_dir, filename + '.png'))

		if (model_name === 'style_transfer') {
			return  [
				filename,
				'jpeg', // output ext
				{
					contentImage: base64_img 
				}
			]

		} else if (model_name === 'munit') {
			return [
				filename,
				'png', // output ext
				{
					image: base64_img,
					style: model_args.length > 0 ? parseInt(model_args[0],10) : 1
				}
			]

		} else if (model_name === 'anime') {
			return [
				filename,
				'png', // output ext
				{
					image: base64_img
				}
			]
		} else if (model_name === 'colorize') {  // DeOldify model
			return [
				filename,
				'jpeg', // output ext
				{
					image: base64_img,
					render_factor: 35
				}
			]
		}
	
	})
}

function assemble_video_from_frames(fps) {

	return new Promise((resolve, reject) => {
		const first_image = fs.readdirSync(input_frames_dir)[0]
		const image_ext = first_image.split('.').pop()

		const cmd = 'ffmpeg'
		const args = [
		  '-y',
		  '-f', 'image2',
		  '-framerate', fps,
		  '-pattern_type', 'sequence',
		  '-start_number', '1',
		  '-r', fps, 
		  '-i', path.join(processed_frames_dir, 'image-%07d.' + image_ext),
		  '-c', 'libx264',
		  '-preset', 'veryslow',
		  // '-tune', 'grain',
		  '-crf', '17',
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
			if (code === 0) {
				clear_dir(input_frames_dir)
				clear_dir(processed_frames_dir)
				console.log('Done assembling video, code:', code)
				resolve()
			} else {
				reject('Can not assemble video')
			}
		})
	})
}

function is_processed (frame_path) {
	const { size } = fs.statSync(frame_path)
	return size > 10000 // file 10kb+ is processed
}

function get_avg_frame_size(frames) {
	let total_size_sum = 0
	frames.forEach((f) => {
		if (fs.existsSync(f)){
     		const { size } = fs.statSync(f)
	    	total_size_sum += size
        }
	})
	return total_size_sum/frames.length
} 


function get_full_paths_of_files_in_dir(dir) {
	return fs.readdirSync(dir).map(file => {
		return path.join(dir, file)
   })
}

function process_frames() {

	return new Promise((resolve, reject) => {

		const img_files = fs.readdirSync(input_frames_dir)
		
		const requests_to_model = create_requests_to_model(model_name, img_files, model_args)

		requests_to_model.forEach((req, i) =>  {

			const [ filename, output_ext, request_obj ] = req
			const output_filename = filename + '.' + output_ext
			const processed_frame_path = path.join(processed_frames_dir, output_filename)

			if (fs.existsSync(processed_frame_path) && is_processed(processed_frame_path)) {
				console.log('Frame already processed: ', processed_frame_path)
				return
			}

			console.log(`Processing frame ` + (i+1) + '/' + requests_to_model.length)

			const res = sync_request('POST', 'http://localhost:8000/query', {
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				json: request_obj
			})

			const body = JSON.parse(res.body)

			res_keys = Object.keys(body)

			const base64Data = body[res_keys[0]].split(',').pop()

			fs.writeFileSync(processed_frame_path, base64Data, 'base64')
		})

  		resolve()
	})     
}

function input_video_to_frames() {

	return new Promise((resolve, reject) => {
		console.log('Video segmentation start')
		if (fs.readdirSync(input_frames_dir).length > 0) {
				console.log('Found frames in ', input_frames_dir, ' skip splitting')
				resolve()
			}
        
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
			console.log('Video segmentation end, going to process')
			resolve()      
		})
	}) 
}

function convert_to_given_fps(fps) {

	return new Promise((resolve, reject) => {
		console.log(`Changing video fps to ${fps}`)

		const input_video = fs.readdirSync(input_dir)[0]

		const cmd = 'ffmpeg'
		const args = [
			'-hide_banner',
			'-y',
			'-i', path.join(__dirname, 'input', input_video),
			'filter:v', `fps=${fps}`,
			'-c', 'libx264',
			'-crf,' '0',
			path.join(input_frames_dir, 'input.mp4')
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
			// delete original video
			fs.unlinkSync(path.join(__dirname, 'input', input_video))
			console.log(`Changed video fps to ${fps}`)
			resolve()      
		})
	}) 
}

// Create dirs if not exist
[input_dir, input_frames_dir, processed_frames_dir, output_dir].forEach(dir => create_dir(dir))
// Clear old log
clear_file(ffmpeg_stderr_path)
// Process file
// convert_to_given_fps()
convert_to_given_fps(fps)
	.then(input_video_to_frames)
	.then(process_frames)
	.then(() => assemble_video_from_frames(fps))
	.catch(err => console.log(err))






