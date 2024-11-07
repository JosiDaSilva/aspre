const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const FtpClient = require('ftp');
const fs = require('fs');

const app = express();

// Configurar middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(bodyParser.json());

// Conectar a la base de datos MySQL
const connection = mysql.createPool({
    host: '190.228.29.61',
    user: 'kalel2016',
    password: 'Kalel2016',
    database: 'ausol',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Configuración del middleware de sesiones
app.use(session({
    secret: 'S1e7b0a3', // Cambia esto por una cadena secreta más segura en producción
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Si estás en HTTPS, cambia a true
}));

// Ruta para la página de login
app.get('/', (req, res) => {
    res.render('login');
});
// Ruta para la página de inicio
app.get('/inicio', (req, res) => {
    // Asegúrate de que los datos necesarios se envían a la vista
    res.render('inicio', { razon: req.session.razon });
});
app.post('/login', async (req, res) => {
    const { codigo_cliente, password } = req.body;

    const query = 'SELECT * FROM aus_cli WHERE id = ? AND password = ?';
    try {
        const [results] = await connection.query(query, [codigo_cliente, password]);
        if (results.length > 0) {
            req.session.codcli = results[0].id;  // Guardamos el código del cliente en la sesión
            req.session.razon = results[0].razon;

            // Redirigir a la página de inicio
            res.render('inicio', { razon: results[0].razon });
        } else {
            // Login fallido
            res.send('Código de cliente o contraseña incorrectos.');
        }
    } catch (err) {
        console.error('Error ejecutando la consulta:', err);
        res.send('Ocurrió un error.');
    }
});
// Ruta para obtener los valores de util y dtofab
app.get('/obtener-valores', async (req, res) => {
    const userId = req.session.codcli;
    try {
        const [rows] = await connection.query('SELECT util, dtofab FROM aus_cli  WHERE id = ?', [userId]); 
        if (rows.length > 0) {
            res.json(rows[0]); // Devuelve el primer registro encontrado
        } else {
            res.status(404).json({ message: 'Valores no encontrados.' });
        }
    } catch (err) {
        console.error('Error al obtener los valores:', err);
        res.status(500).json({ message: 'Error del servidor.', error: err.message }); // Proporciona más información sobre el error
    }
});

// Ruta para guardar los valores de util y dtofab
app.post('/guardar-valores', async (req, res) => {
    const { util, dtofab } = req.body;
    const userId = req.session.codcli; // Obtén el ID del usuario logueado desde la sesión

    try {
        // Actualiza los valores de util y dtofab para el ID del usuario logueado
        const [result] = await connection.query('UPDATE aus_cli SET util = ?, dtofab = ? WHERE id = ?', [util, dtofab, userId]);
        
        // Verificar si se actualizó alguna fila
        if (result.affectedRows > 0) {
            res.json({ message: 'Valores actualizados correctamente.' });
        } else {
            res.status(404).json({ message: 'No se encontraron filas para actualizar.' });
        }
    } catch (err) {
        console.error('Error al guardar los valores:', err);
        res.status(500).json({ message: 'Error del servidor.', error: err.message }); // Proporciona más información sobre el error
    }
});


app.get('/cuentacorriente', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado desde la sesión
    const razon = req.session.razon;   // Obtener la razón del usuario desde la sesión
    const limit = 15; // Cantidad de registros a mostrar por página
    const offset = parseInt(req.query.page) || 0; // Página actual

    if (!codcli) {
        // Si no hay código de cliente en la sesión, redirigimos al login
        return res.redirect('/');
    }

    // Consulta a la base de datos para obtener movimientos
    const query = 'SELECT * FROM aus_famov WHERE codcli = ? LIMIT ? OFFSET ?';
    try {
        const [results] = await connection.query(query, [codcli, limit, offset]);
        // Pasamos los movimientos y la razón a la vista
        res.render('cuentacorriente', { movimientos: results, razon: razon, page: offset });
    } catch (err) {
        console.error('Error al obtener datos de cuenta corriente:', err);
        res.status(500).send('Error del servidor');
    }
});

// Ruta para descargar PDFs
app.get('/download-pdf', (req, res) => {
    const numero = req.query.numero;
    const codcli = req.query.codcli;
    
    const formattedNumero = numero.toString().padStart(9, '0');
    const formattedCodcli = codcli.toString().padStart(3, '0');
    const pdfFilename = `FACT-${formattedNumero} ${formattedCodcli}.pdf`;

    const client = new FtpClient();

    client.on('ready', () => {
        const remoteFilePath = `/pdf/${pdfFilename}`;
        const localTempFile = path.join(__dirname, pdfFilename);

        client.get(remoteFilePath, (err, stream) => {
            if (err) {
                res.status(404).send('Archivo no encontrado');
                client.end();
                return;
            }

            stream.once('close', () => client.end());
            stream.pipe(fs.createWriteStream(localTempFile)).on('finish', () => {
                res.download(localTempFile, pdfFilename, (err) => {
                    if (err) {
                        console.error('Error descargando el archivo', err);
                    }
                    fs.unlinkSync(localTempFile); // Elimina el archivo temporal después de la descarga
                });
            });
        });
    });

    client.connect({
        host: 'ftp.spowerinfo.com.ar',
        user: 'ausolpub.spowerinfo.com.ar', // tu usuario FTP
        password: 'ausol' // tu contraseña FTP
    });
});

// Ruta para obtener ofertas
// Ruta para obtener ofertas
app.get('/ofertas', async (req, res) => {
    const query = 'SELECT id, denom, precio, prove, codbar, porofe, stock, stkcor, canofe FROM aus_art WHERE porofe <> 0';
    try {
        const [results] = await connection.query(query);
        
        // Calcular el precio con el descuento correctamente
        results.forEach(articulo => {
            const descuento = (articulo.precio * Math.abs(articulo.porofe)) / 100; // Convertir porofe a positivo
            articulo.precioOferta = (articulo.precio - descuento).toFixed(2); // Calcular el precio con oferta
        });
        res.render('ofertas', { articulos: results });
    } catch (err) {
        console.error('Error obteniendo las ofertas:', err);
        res.status(500).send('Error del servidor');
    }
});


app.get('/precios', async (req, res) => {
    const page = parseInt(req.query.page) || 1; // Obtén el número de página o usa 1 por defecto
    const pageSize = 100; // Número de artículos por página
    const offset = (page - 1) * pageSize; // Calcula el desplazamiento
    
    const userId = req.session.codcli; // Obtén el ID del usuario logueado
    
    try {
        // Consulta para obtener los valores de util y dtofab del usuario logueado
        const [userResult] = await connection.query('SELECT util, dtofab FROM aus_cli WHERE id = ?', [userId]);
        if (userResult.length === 0) {
            return res.redirect('/');
        }
        
        const { util, dtofab } = userResult[0];

        // Log los valores de utilidad y descuento
        console.log('Utilidad:', util, 'Descuento:', dtofab);

        // Consulta para obtener los artículos con sus precios
        const [articulos] = await connection.query(
            'SELECT id, denom, precio, codbar, stock, stkcor, porofe, canofe FROM aus_art LIMIT ?, ?', 
            [offset, pageSize]
        );
        
        // Calcula el precio y precio de venta para cada artículo
        articulos.forEach(articulo => {
         

            // Aplica dtofab al precio base
            let precioConDescuento = articulo.precio - (articulo.precio * dtofab / 100);
          

            // Aplica porofe al precio ya descontado
            let precioAjustado = precioConDescuento + (precioConDescuento * (articulo.porofe || 0) / 100);
          

            // Calcula el precio de venta con utilidad
            const precioConUtilidad = precioAjustado + (precioAjustado * util / 100);
         

            // Agrega IVA al precio de venta
            articulo.precio_venta = precioConUtilidad + (precioConUtilidad * 0.21);
          

            // Actualiza el precio con descuento en el objeto
            articulo.precio = precioConDescuento; // Actualiza el precio en el objeto
        });
        
        // Renderiza la vista con los artículos y la página actual
        res.render('precios', { articulos, page });
    } catch (err) {
        console.error('Error obteniendo los artículos:', err);
        res.status(500).send('Error del servidor');
    }
});


app.post('/buscar-articulos', async (req, res) => {
    const searchTerm = req.body.searchTerm;

    // Dividir el término de búsqueda en palabras individuales
    const words = searchTerm.split(' ').filter(word => word.length > 0);
    const likeQueries = words.map(word => `denom LIKE ?`).join(' AND ');
    const values = words.map(word => `%${word}%`);

    try {
        const [articulos] = await connection.query(
            `SELECT * FROM aus_art WHERE (${likeQueries}) OR codbar LIKE ?`, 
            [...values, `%${searchTerm}%`]
        );
        console.log('Artículos encontrados:', articulos); // Agregar esto para depuración

        // Si se encuentran artículos, ajustar precios
        if (articulos.length > 0) {
            const userId = req.session.codcli; // Obtén el ID del usuario logueado
            const [userResult] = await connection.query('SELECT util, dtofab FROM aus_cli WHERE id = ?', [userId]);
            const { util, dtofab } = userResult[0];

        // Calcula el precio y precio de venta para cada artículo
        articulos.forEach(articulo => {
          

            // Aplica dtofab al precio base
            let precioConDescuento = articulo.precio - (articulo.precio * dtofab / 100);
          

            // Aplica porofe al precio ya descontado
            let precioAjustado = precioConDescuento + (precioConDescuento * (articulo.porofe || 0) / 100);
          

            // Calcula el precio de venta con utilidad
            const precioConUtilidad = precioAjustado + (precioAjustado * util / 100);
          

            // Agrega IVA al precio de venta
            articulo.precio_venta = precioConUtilidad + (precioConUtilidad * 0.21);
          

            // Actualiza el precio con descuento en el objeto
            articulo.precio = precioConDescuento; // Actualiza el precio en el objeto
        });
            return res.json({ success: true, articulos });
        } else {
            return res.json({ success: false, message: 'No se encontraron artículos.' });
        }
    } catch (error) {
        console.error('Error en la búsqueda:', error);
        return res.status(500).json({ success: false, message: 'Error en la búsqueda de artículos.' });
    }
});


app.post('/logout', (req, res) => {
    // Lógica para cerrar sesión
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error al cerrar sesión.' });
        }
        return res.json({ success: true, message: 'Sesión cerrada con éxito.' });
    });
});




// Ruta para agregar productos al carrito
app.post('/agregar-carrito', async (req, res) => {
    const codcli = req.session.codcli; 
    const { codbar, cantidad, zona } = req.body; 

    // Obtener la fecha actual en formato YYYY-MM-DD
    const fecha = new Date().toISOString().slice(0, 10);

    // 1. Obtener la descripción y precio del artículo
    const descripcionPrecioQuery = 'SELECT denom, precio FROM aus_art WHERE codbar = ?';
    try {
        const [result] = await connection.query(descripcionPrecioQuery, [codbar]);
        
        // Verificar que se encontró el artículo
        if (result.length === 0) {
            return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
        }

        const descripcion = result[0].denom; // Asumimos que la descripción es la primera (y única) fila
        const precio = result[0].precio; // Asumimos que el precio es el mismo

        // 2. Insertar en la tabla aus_carrito
        const query = 'INSERT INTO aus_carrito (codcli, codbar, descripcion, cantidad, zona, fecha, precio) VALUES (?, ?, ?, ?, ?, NOW(), ?)';
        await connection.query(query, [codcli, codbar, descripcion, cantidad, zona, precio]);
        
        console.log('Producto agregado al carrito.');
        return res.status(200).json({ success: true, message: 'Producto agregado correctamente' });
    } catch (err) {
        console.error('Error al agregar el producto al carrito:', err);
        return res.status(500).json({ success: false, message: 'Error al agregar el producto al carrito' });
    }
});
// Ruta para obtener el carrito
app.get('/carrito', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado desde la sesión

    if (!codcli) {
        return res.json([]); // Si no hay código de cliente en la sesión, respondemos con un array vacío
    }

    try {
        // Consulta a la base de datos para obtener los artículos en el carrito del cliente
        const query = 'SELECT codbar, descripcion, cantidad, precio, zona FROM aus_carrito WHERE codcli = ?';
        const [results] = await connection.execute(query, [codcli]);
        
        res.json(results); // Respondemos con los resultados obtenidos
    } catch (err) {
        console.error('Error al obtener datos del carrito: ', err);
        return res.status(500).send('Error del servidor');
    }
});
// Ruta para actualizar la cantidad
app.post('/actualizar-cantidad', async (req, res) => {
    const { codbar, cantidad } = req.body;
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado desde la sesión

    if (!codcli) {
        return res.status(400).json({ message: "Código de cliente no encontrado en la sesión." });
    }

    const sql = "UPDATE aus_carrito SET cantidad = ? WHERE codbar = ? AND codcli = ?";
    try {
        const [results] = await connection.execute(sql, [cantidad, codbar, codcli]);

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: "Artículo no encontrado en el carrito." });
        }

        res.status(200).send({ message: "Cantidad actualizada." });
    } catch (error) {
        console.error('Error al actualizar la cantidad: ', error);
        return res.status(500).json({ error });
    }
});

// Ruta para eliminar un artículo
app.post('/eliminar-articulo', async (req, res) => {
    const { codbar } = req.body;

    if (!codbar) {
        return res.status(400).send('El código de barras es requerido');
    }

    try {
        // Verifica si el artículo existe antes de eliminar
        const [results] = await connection.execute('SELECT * FROM aus_carrito WHERE codbar = ?', [codbar]);
        
        if (results.length === 0) {
            return res.status(404).send('Artículo no encontrado');
        }

        // Procede a eliminar
        const query = 'DELETE FROM aus_carrito WHERE codbar = ?';
        await connection.execute(query, [codbar]);
        
        res.send('Artículo eliminado con éxito');
    } catch (err) {
        console.error('Error al eliminar el artículo:', err);
        return res.status(500).send('Error al eliminar el artículo');
    }
});

app.post('/enviar-pedido', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado
    const { transporte, obs = "", zona } = req.body; // Obtener los datos necesarios

    if (!codcli || !transporte || !zona) {
        return res.status(400).json({ message: "Faltan datos necesarios." });
    }

    try {
        // Consulta para obtener los artículos del carrito del usuario en la zona seleccionada
        const queryCarrito = 'SELECT codbar, cantidad, precio, zona FROM aus_carrito WHERE codcli = ? AND zona = ?';
        const [results] = await connection.execute(queryCarrito, [codcli, zona]);

        // Verificar que haya artículos en el carrito
        if (results.length === 0) {
            return res.status(400).json({ message: "No hay artículos en el carrito para la sucursal seleccionada." });
        }

        // Preparar la consulta de inserción en la tabla aus_ped
        const insertQuery = 'INSERT INTO aus_ped (codcli, transporte, fecha, obs, codori, cantidad, zona, costo, stock, lineas) VALUES ?';
        const fecha = new Date(); // Obtener la fecha actual

        // Crear un arreglo de valores para insertar
        const values = results.map(item => {
            return [
                codcli,
                transporte,
                fecha,
                obs,
                item.codbar, // Usar el codbar original sin modificaciones
                item.cantidad,
                item.zona, 
                item.precio, 
                1, // Establecer stock en 1
                1
            ];
        });


        // Insertar los datos en la tabla aus_ped
        await connection.query(insertQuery, [values]);

        // Limpiar el carrito después de enviar el pedido para esa zona
        const deleteQuery = 'DELETE FROM aus_carrito WHERE codcli = ? AND zona = ?';
        await connection.execute(deleteQuery, [codcli, zona]);
        console.log(results)
        res.status(200).json({ message: "Pedido enviado con éxito." });
    } catch (error) {
        console.error('Error al enviar el pedido: ', error);
        return res.status(500).send('Error del servidor');
    }
});

// Ruta para obtener equivalencias
app.get('/equivalencias/:codbar', async (req, res) => {
    const codbar = req.params.codbar;
    try {
        // Obtener las equivalencias
        const [equivalencias] = await connection.execute(
            `SELECT 
                eq.equiv1, eq.equiv2, eq.equiv3, eq.equiv4, eq.equiv5
             FROM 
                aus_faeqv AS eq
             WHERE 
                eq.codigo = ?`, [codbar]
        );

        if (equivalencias.length > 0) {
            const equivalenciaResults = [];

            // Búsqueda de precio y stock para cada equivalencia
            for (const eq of equivalencias) {
                for (let i = 1; i <= 5; i++) {
                    const equivKey = `equiv${i}`;
                    const equivValue = eq[equivKey];

                    if (equivValue) {
                        // Formatear el valor de la equivalencia
                        const formattedEquiv = equivValue.replace(/\s+/g, '-') // Reemplazar espacios con guiones
                                                          .toUpperCase(); // Convertir a mayúsculas

                        // Buscar precio y stock en aus_art
                        const [articulo] = await connection.execute(
                            `SELECT precio, stock 
                             FROM aus_art 
                             WHERE codbar = ?`, [formattedEquiv]
                        );

                        if (articulo.length > 0) {
                            equivalenciaResults.push({
                                equivalencia: equivValue,
                                precio: articulo[0].precio,
                                stock: articulo[0].stock
                            });
                        } else {
                            equivalenciaResults.push({
                                equivalencia: equivValue,
                                precio: null,
                                stock: null,
                                message: 'No se encontraron datos para esta equivalencia.'
                            });
                        }
                    }
                }
            }

            // Asegúrate de que se devuelven las equivalencias en el formato correcto
            res.json({ success: true, equivalencias: equivalenciaResults });
        } else {
            res.json({ success: false, message: 'No se encontraron equivalencias.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error al obtener las equivalencias.' });
    }
});



app.get('/estado', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado

    try {
        // Consulta que agrupa los pedidos por número y filtra por codcli
        const [pedidos] = await connection.query(`
            SELECT codcli, transporte, fecha, numero 
            FROM aus_seg 
            WHERE codcli = ? 
            GROUP BY numero
        `, [codcli]);

        res.render('estado', { pedidos });
    } catch (error) {
        console.error('Error obteniendo los pedidos:', error);
        res.status(500).send('Error al cargar los pedidos');
    }
});

app.get('/pedido-detalle/:numero', async (req, res) => {
    const numeroPedido = req.params.numero;
    const codcli = req.session.codcli; // Obtener el codcli del usuario logueado

    try {
        // Consulta para obtener las líneas del pedido del cliente logueado
        const [lineasPedido] = await connection.query(
            'SELECT codori, cantidad, descri, sit FROM aus_seg WHERE numero = ? AND codcli = ?',
            [numeroPedido, codcli]
        );

        res.json(lineasPedido);
    } catch (error) {
        console.error('Error obteniendo los detalles del pedido:', error);
        res.status(500).json({ message: 'Error obteniendo los detalles del pedido' });
    }
});


// Servidor escuchando
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
