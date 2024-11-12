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

        // Consulta para obtener los artículos con sus precios, paginados
        const [articulos] = await connection.query(
            'SELECT id, denom, precio, codbar, stock, stkcor, porofe, canofe, prove FROM aus_art LIMIT ?, ?', 
            [offset, pageSize]
        );

        // Obtener los códigos de proveedor de los artículos
        const proveedores = articulos.map(articulo => articulo.prove);

        // Consulta para obtener las utilidades de los proveedores de los artículos en una sola consulta
        const [utilidadesProveedorResult] = await connection.query(
            'SELECT codpro, utilidad FROM aus_fauti WHERE codcli = ? AND codpro IN (?)', 
            [userId, proveedores]
        );

        // Crear un mapa de utilidades para los proveedores
        const utilidadMap = {};
        utilidadesProveedorResult.forEach(item => {
            utilidadMap[item.codpro] = item.utilidad;
        });

        // Calcula el precio y precio de venta para cada artículo
        for (const articulo of articulos) {
            const codpro = articulo.prove; // Obtener el código de proveedor del artículo

            // Determina la utilidad a aplicar: la del proveedor o la del cliente logueado si no existe
            let utilidadAplicada = utilidadMap[codpro] !== undefined ? utilidadMap[codpro] : util;

            // Aplica dtofab al precio base
            let precioConDescuento = articulo.precio - (articulo.precio * dtofab / 100);

            // Aplica porofe al precio ya descontado
            let precioAjustado = precioConDescuento + (precioConDescuento * (articulo.porofe || 0) / 100);

            // Calcula el precio de venta con utilidad
            const precioConUtilidad = precioAjustado + (precioAjustado * utilidadAplicada / 100);

            // Agrega IVA al precio de venta
            articulo.precio_venta = precioConUtilidad + (precioConUtilidad * 0.21);

            // Actualiza el precio con descuento en el objeto
            articulo.precio = precioConDescuento; // Actualiza el precio en el objeto
        }

        // Consulta para obtener los proveedores
        const [proveedoresResult] = await connection.query('SELECT codigo, razon FROM aus_pro');

        // Renderiza la vista con los artículos y la página actual
        res.render('precios', { proveedores: proveedoresResult, articulos, page });
    } catch (err) {
        console.error('Error obteniendo los artículos:', err);
        res.status(500).send('Error del servidor');
    }
});


// Ruta para cargar los proveedores
app.get('/cargar-proveedores', async (req, res) => {
    try {
        const sql = "SELECT codigo, razon FROM aus_pro";
        const [resultados] = await connection.query(sql); // Utiliza await y destructuración
        res.json({ proveedores: resultados });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/filtrar-articulos', async (req, res) => {
    const proveedorId = req.body.proveedorId;

    if (!proveedorId) {
        return res.status(400).json({ success: false, message: 'El ID del proveedor es requerido.' });
    }

    try {
        // Obtén todos los artículos del proveedor seleccionado
        const [articulos] = await connection.query(
            `SELECT * FROM aus_art WHERE prove = ?`, 
            [proveedorId]
        );

        if (articulos.length > 0) {
            const userId = req.session.codcli;

            // Obtén los datos de utilidad y dtofab del cliente logueado
            const [userResult] = await connection.query(
                'SELECT util, dtofab FROM aus_cli WHERE id = ?', 
                [userId]
            );
            const { util, dtofab } = userResult[0];

            // Obtén todas las utilidades de los proveedores asociados a los artículos en una sola consulta
            const proveedorCodigos = articulos.map(articulo => articulo.prove);
            const [utilidadesProveedor] = await connection.query(
                'SELECT codpro, utilidad FROM aus_fauti WHERE codcli = ? AND codpro IN (?)', 
                [userId, proveedorCodigos]
            );

            // Mapea las utilidades de los proveedores para acceso rápido
            const utilidadMap = {};
            utilidadesProveedor.forEach(item => {
                utilidadMap[item.codpro] = item.utilidad;
            });

            // Calcula el precio y precio de venta para cada artículo
            for (const articulo of articulos) {
                // Determina la utilidad a aplicar: la del proveedor o la del cliente logueado si no existe
                const utilidadAplicada = utilidadMap[articulo.prove] !== undefined
                    ? utilidadMap[articulo.prove]
                    : util;

                // Aplica dtofab al precio base
                let precioConDescuento = articulo.precio - (articulo.precio * dtofab / 100);

                // Aplica porofe al precio ya descontado
                let precioAjustado = precioConDescuento + (precioConDescuento * (articulo.porofe || 0) / 100);

                // Calcula el precio de venta con utilidad
                const precioConUtilidad = precioAjustado + (precioAjustado * utilidadAplicada / 100);

                // Agrega IVA al precio de venta
                articulo.precio_venta = precioConUtilidad + (precioConUtilidad * 0.21);

                // Actualiza el precio con descuento en el objeto
                articulo.precio = precioConDescuento;
            }

            return res.json({ success: true, articulos });
        } else {
            return res.json({ success: false, message: 'No se encontraron artículos para este proveedor.' });
        }
    } catch (error) {
        console.error('Error en el filtrado de artículos:', error);
        return res.status(500).json({ success: false, message: 'Error al filtrar los artículos.' });
    }
});





app.post('/buscar-articulos', async (req, res) => {
    const searchTerm = req.body.searchTerm;

    // Divide el término de búsqueda en palabras y crea una consulta de búsqueda flexible
    const words = searchTerm.split(' ').filter(word => word.length > 0);
    const likeQueries = words.map(word => `denom LIKE ?`).join(' AND ');
    const values = words.map(word => `%${word}%`);

    try {
        // Busca los artículos que coincidan con el término de búsqueda o código de barras
        const [articulos] = await connection.query(
            `SELECT id, denom, precio, codbar, stock, stkcor, porofe, canofe, prove 
            FROM aus_art 
            WHERE (${likeQueries}) OR codbar LIKE ?`, 
            [...values, `%${searchTerm}%`]
        );

        if (articulos.length > 0) {
            const userId = req.session.codcli;

            // Obtén la utilidad y dtofab del cliente logueado
            const [userResult] = await connection.query(
                'SELECT util, dtofab FROM aus_cli WHERE id = ?', 
                [userId]
            );
            const { util, dtofab } = userResult[0];

            // Obtén las utilidades de todos los proveedores en una sola consulta
            const proveedorCodigos = [...new Set(articulos.map(articulo => articulo.prove))];
            const [utilidadesProveedor] = await connection.query(
                'SELECT codpro, utilidad FROM aus_fauti WHERE codcli = ? AND codpro IN (?)', 
                [userId, proveedorCodigos]
            );

            // Mapea las utilidades de los proveedores para acceso rápido
            const utilidadMap = {};
            utilidadesProveedor.forEach(item => {
                utilidadMap[item.codpro] = item.utilidad;
            });

            // Calcula el precio de venta para cada artículo usando la utilidad y dtofab adecuados
            for (const articulo of articulos) {
                const codpro = articulo.prove;
                const utilidadAplicada = utilidadMap[codpro] !== undefined ? utilidadMap[codpro] : util;

                // Aplica dtofab y porofe al precio base
                let precioConDescuento = articulo.precio - (articulo.precio * dtofab / 100);
                let precioAjustado = precioConDescuento + (precioConDescuento * (articulo.porofe || 0) / 100);

                // Calcula el precio de venta con la utilidad aplicada
                const precioConUtilidad = precioAjustado + (precioAjustado * utilidadAplicada / 100);

                // Agrega IVA al precio de venta final
                articulo.precio_venta = precioConUtilidad + (precioConUtilidad * 0.21);

                // Actualiza el precio con descuento en el objeto del artículo
                articulo.precio = precioConDescuento;
            }

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

    try {
        // 1. Obtener el descuento (dtofab) del cliente
        const descuentoQuery = 'SELECT dtofab FROM aus_cli WHERE id = ?';
        const [clienteResult] = await connection.query(descuentoQuery, [codcli]);

        // Verificar que el cliente existe
        if (clienteResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
        }

        const dtofab = clienteResult[0].dtofab; // Descuento del cliente

        // 2. Obtener la descripción y precio del artículo
        const descripcionPrecioQuery = 'SELECT denom, precio FROM aus_art WHERE codbar = ?';
        const [articuloResult] = await connection.query(descripcionPrecioQuery, [codbar]);
        
        // Verificar que se encontró el artículo
        if (articuloResult.length === 0) {
            return res.status(404).json({ success: false, message: 'Artículo no encontrado' });
        }

        const descripcion = articuloResult[0].denom;
        const precio = articuloResult[0].precio;

        // 3. Calcular el precio con descuento
        const descuentoAplicado = (precio * dtofab) / 100;
        const precioConDescuento = precio - descuentoAplicado;

        // 4. Insertar en la tabla aus_carrito con el precio calculado
        const query = `
            INSERT INTO aus_carrito (codcli, codbar, descripcion, cantidad, zona, fecha, precio)
            VALUES (?, ?, ?, ?, ?, NOW(), ?)
        `;
        await connection.query(query, [codcli, codbar, descripcion, cantidad, zona, precioConDescuento]);
        
        console.log('Producto agregado al carrito con descuento aplicado.');
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
// Middleware para parsear los datos de formulario
app.use(express.urlencoded({ extended: true }));  // Para manejar formularios con datos codificados en URL
app.use(express.json());  // Para manejar solicitudes con datos en formato JSON

// Ruta para obtener los proveedores y mostrar la ventana de utilidad
app.get('/utilidad', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el código del cliente logueado desde la sesión

    if (!codcli) {
        return res.status(400).json({ message: "Código de cliente no encontrado en la sesión." });
    }

    const sql = `
        SELECT p.codigo, p.razon, IFNULL(f.utilidad, '') AS utilidad
        FROM aus_pro p
        LEFT JOIN aus_fauti f ON f.codcli = ? AND f.codpro = p.codigo
        WHERE NOT EXISTS (
            SELECT 1 
            FROM aus_fauti f 
            WHERE f.codcli = ? AND f.codpro = p.codigo
        ) OR f.codcli = ?  -- Incluye los que ya tienen utilidad
    `;

    try {
        const [productos] = await connection.execute(sql, [codcli, codcli, codcli]);

        // Enviar la vista con los productos obtenidos y sus utilidades
        res.render('utilidad.ejs', { productos });
    } catch (error) {
        console.error('Error al obtener los proveedores: ', error);
        return res.status(500).json({ error });
    }
});
app.post('/guardar-utilidad', async (req, res) => {
    const codcli = req.session.codcli; // Obtener el código del cliente logueado desde la sesión

    if (!codcli) {
        return res.status(400).json({ message: "Código de cliente no encontrado en la sesión." });
    }

    // Recolectar las utilidades ingresadas en el formulario
    const utilidades = [];
    for (const key in req.body) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
            const codpro = key.replace('utilidad_', ''); // Extraer el código del proveedor del nombre del campo
            const utilidad = req.body[key];

            // Verifica que la utilidad haya sido modificada antes de agregarla al array
            if (utilidad !== "") {  // Si el valor no está vacío (es decir, ha sido modificado)
                utilidades.push([codcli, codpro, utilidad]);
            }
        }
    }

    if (utilidades.length === 0) {
        return res.status(400).json({ message: "No se han ingresado utilidades modificadas." });
    }

    // SQL para insertar o actualizar las utilidades
    const sqlInsertOrUpdate = `
        INSERT INTO aus_fauti (codcli, codpro, utilidad) 
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE utilidad = VALUES(utilidad);
    `;

    try {
        // Ejecutar la operación de inserción o actualización en la base de datos
        for (const [codcli, codpro, utilidad] of utilidades) {
            // Primero, verifica si el registro ya existe
            const checkQuery = 'SELECT id FROM aus_fauti WHERE codcli = ? AND codpro = ?';
            const [existingRecord] = await connection.execute(checkQuery, [codcli, codpro]);

            if (existingRecord.length > 0) {
                // Si ya existe, actualizamos la utilidad
                const updateQuery = 'UPDATE aus_fauti SET utilidad = ? WHERE codcli = ? AND codpro = ?';
                await connection.execute(updateQuery, [utilidad, codcli, codpro]);
                console.log(`Utilidad actualizada para codcli: ${codcli}, codpro: ${codpro}`);
            } else {
                // Si no existe, insertamos un nuevo registro
                await connection.execute(sqlInsertOrUpdate, [codcli, codpro, utilidad]);
                console.log(`Nueva utilidad guardada para codcli: ${codcli}, codpro: ${codpro}`);
            }
        }

        // Redirigir a la página de utilidad después de guardar
        res.redirect('/utilidad'); // Redirige a /utilidad después de guardar
    } catch (error) {
        console.error('Error al guardar o actualizar las utilidades: ', error);
        return res.status(500).json({ error });
    }
});






// Servidor escuchando
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
