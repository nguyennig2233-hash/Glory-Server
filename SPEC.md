# Glory Cosmetics: định dạng và cách port sang phiên bản khác

## Vì sao cùng một file chạy được mọi phiên bản
Mô hình không chứa gì của riêng Minecraft: chỉ là các khối hộp, UV từng mặt và một ảnh PNG. Launcher tải file này từ máy chủ và ghi vào `config/glory-cosmetics/` của từng instance, bất kể phiên bản game. Chỉ phần vẽ là phụ thuộc phiên bản. Mỗi dòng game cần một mod nhỏ (như thư mục này cho 1.21.5) đọc cùng định dạng.

## Tệp trong `config/glory-cosmetics/`
- `manifest.json`: `{ "v": 1, "equip": { "head": "<id>", "back": "<id>", "armR": "<id>", "armL": "<id>", "legR": "<id>", "legL": "<id>" }, "items": { "<id>": { "slot", "name" } } }`
- `models/<id>.json`: `{ "v":1, "w":64, "h":64, "slot":"head", "tf":{...}, "els":[ { "f":[x,y,z], "t":[x,y,z], "o":[x,y,z], "r":[rx,ry,rz], "fc":{ "north":[u1,v1,u2,v2,rot], ... } } ] }`
- `tex/<id>.png`: texture tối đa 256×256.

## Sáu vị trí đeo và điểm neo
Mô hình dùng khối Blockbench 16×16×16, mặt trước nhìn về -z, y hướng lên. Điểm (8,0,8) của mô hình được đặt vào điểm neo của vị trí đeo, rồi áp phép chỉnh `tf` do người đăng đặt trong launcher.

| slot | gắn vào | điểm neo (giữa đáy bộ phận) |
|---|---|---|
| head | xương đầu | đáy đầu (cổ), mũ nằm phía trên |
| back | xương thân | đáy thân (eo), cánh/ba lô nằm sau |
| armR / armL | tay phải / trái | lòng bàn tay (đáy cánh tay) |
| legR / legL | chân phải / trái | bàn chân (đáy chân) |

Phép chỉnh `tf` = `{ "m":[x,y,z], "r":[x,y,z], "s":[x,y,z] }`: phóng quanh điểm (8,0,8), xoay X rồi Y rồi Z (độ), rồi dời `m` (đơn vị pixel). Mỗi phần tử còn có phép xoay riêng `r` quanh `o` được áp trước. Công thức nằm ở `CosModel.xform` (`renderer/cosmodel.js`) và `CosItem.place` (Java), hai nơi phải giống nhau. Máy chủ từ chối món có điểm nào xa điểm neo quá 64 pixel.

Đổi sang không gian xương của Minecraft (pixel/16, y hướng xuống, x đảo dấu): `(−lx, anchorY − ly, lz)`, với `anchorY` = 0 cho đầu, 12 cho thân, tay, chân; tay còn lệch x −1 (phải) hoặc +1 (trái).
- Thứ tự đỉnh/UV mỗi mặt giống `FaceInfo` của Minecraft (xem `renderer/cosm3d.js`, bảng `FV`, và `CosItem.java`). UV theo pixel của texture (`w` × `h`), `rot` xoay 0/90/180/270.

## Cấu trúc dự án nhiều phiên bản
```
common/java/.../CosCore.java   đọc manifest, dựng mặt, áp tf, đưa đỉnh cho từng phiên bản. KHÔNG chứa mã Minecraft (đã chạy thử, khớp 100% với renderer/cosmodel.js)
adapters/<thời kỳ>/            mỗi thời kỳ API vẽ một thư mục ~80 dòng: đăng ký feature renderer, nạp texture, gọi vertex(...)
mcX_Y_Z/build.gradle           một dự án Gradle cho mỗi phiên bản game (chọn adapter + Yarn + Fabric API)
```
| Phiên bản game | adapter | khác biệt chính |
|---|---|---|
| 1.16.x | v1_16 | Java 8; xương thân tên `torso`; `getModel()`/`getNormal()`; callback đăng ký 3 tham số |
| 1.17 đến 1.19.2 | v1_17 | như v1_16 nhưng xương `body`, `getPositionMatrix()`/`getNormalMatrix()` (lớp `net.minecraft.util.math`), callback 4 tham số |
| 1.19.3 đến 1.20.6 | v1_20 | feature renderer nhận entity; ma trận JOML; `vertex(Matrix4f…)`, `normal(Matrix3f…)` và `.next()` |
| 1.21.1 | v1_21_1 | nhận entity; `vertex(MatrixStack.Entry…)` không còn `.next()`; `Identifier.of` |
| 1.21.2 đến 1.21.4 | v1_21_4 | nhận render state (không còn entity) |
| 1.21.5 | v1_21_5 | như 1.21.4, `NativeImageBackedTexture` thêm tên |

Thêm một phiên bản cùng thời kỳ: tạo thư mục `mcX_Y_Z/` với một `build.gradle` (chép từ bản gần nhất), thêm vào `settings.gradle` và danh sách `matrix` trong `.github/workflows/build-cosmetics.yml`. Thêm thời kỳ mới: chép adapter gần nhất rồi sửa theo lỗi biên dịch.

## Build (không cần cài gì trên máy)
1. Đưa thư mục `.github/` và `mod-src/` lên GitHub (cùng kho với launcher).
2. Vào tab Actions, chọn "Build Glory Cosmetics", bấm Run workflow. Mỗi phiên bản build riêng, phiên bản nào lỗi sẽ đỏ riêng và cho xem nguyên văn lỗi.
3. Tải các artifact về, giải nén vào một thư mục, chạy `node scripts/install-cosmetics.js <thư mục đó>`: file jar tự vào `resources/mods/<phiên bản>/`, nơi launcher lấy jar cho phiên bản đó.

## Không hỗ trợ
- 1.10 trở xuống: không làm.
- Đã có Fabric 1.16 đến 1.21.5 (mỗi mcX_Y_Z là một jar chạy cho cả một khoảng phiên bản, xem `mcdep` và bảng RANGES trong cosmetics.js; `node scripts/test-cos-ranges.js` kiểm tra hai bên khớp nhau). Chưa có: 1.14-1.15 (API vẽ khác), 1.11-1.13 (OpenGL cũ, cần Legacy Fabric hoặc Forge) và Forge/vanilla. Lõi `CosCore` dùng lại được nguyên vẹn và biên dịch được với Java 8.
- Forge / vanilla: mod hiện là mod Fabric.

## Trạng thái
`CosCore` đã biên dịch và so với `CosModel.xform` bằng 120 đỉnh có đủ phóng, xoay, dời: sai lệch 0. Các adapter CHƯA từng biên dịch hay chạy trong Minecraft (môi trường làm việc không có Minecraft/Fabric). Tên lớp/hàm Yarn và chữ ký có thể lệch vài chỗ, nhất là: `NativeImageBackedTexture` (1.21.5), `EntityRenderState.x/y/z` và chữ ký `render(...)` của 1.21.2+, `LivingEntityFeatureRendererRegistrationCallback`. Khi Actions báo đỏ, gửi nguyên văn lỗi, mỗi lỗi thường sửa 1-2 dòng. Hiện chỉ vẽ cho chính người chơi; hiển thị cosmetic của người khác cần mod hỏi máy chủ theo tên người chơi (chưa làm).
