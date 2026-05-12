from PIL import Image
import numpy as np

src = r"C:\Users\Usuario\Desktop\cfda51a2-87e2-46ff-9d24-067b252ae25c.jpg"
dst = r"C:\Users\Usuario\Desktop\febi\CatalogoFebi\img\icon-distribucion.png"

img = Image.open(src).convert("RGBA")
data = np.array(img, dtype=np.float32)

# Luminance of each pixel (0=black, 255=white)
lum = 0.299 * data[:,:,0] + 0.587 * data[:,:,1] + 0.114 * data[:,:,2]

# Alpha = inverse of luminance: black lines become opaque, white bg transparent
alpha = 255 - lum

# Make all visible pixels pure black so CSS filters work cleanly
data[:,:,0] = 0
data[:,:,1] = 0
data[:,:,2] = 0
data[:,:,3] = np.clip(alpha, 0, 255)

result = Image.fromarray(data.astype(np.uint8), "RGBA")
result.save(dst, "PNG")
print("Guardado:", dst)
